import { Duplex } from 'stream';
import tls from 'tls';
import crypto from 'crypto';
import { GoogleAuth } from 'google-auth-library';

/**
 * Minimal AlloyDB connector for `pg` (there is no official Node.js AlloyDB connector).
 *
 * Implements the same protocol as the AlloyDB Auth Proxy / Go connector:
 *  1. Generate an RSA key pair and ask the AlloyDB Admin API for a short-lived client certificate
 *     (`generateClientCertificate`, with metadata exchange enabled).
 *  2. Open mutual-TLS to the instance on port 5433, verifying the server against the cluster CA.
 *  3. Send a MetadataExchangeRequest (length-prefixed protobuf) carrying an OAuth2 token, read the response.
 *  4. Hand the socket to `pg`, which then speaks plain Postgres wire protocol over it.
 *
 * Works from anywhere with IAM access (laptop or Cloud Run) without VPC, PSC or an Auth Proxy binary.
 * Callers need roles/alloydb.client (+ roles/serviceusage.serviceUsageConsumer).
 */

const SERVER_PORT = 5433;
const CERT_TTL_SECONDS = 3600;
const REFRESH_MARGIN_MS = 5 * 60_000;
const ADMIN_API = 'https://alloydb.googleapis.com/v1beta';
const USER_AGENT = 'snagwalk-alloydb-connector/0.1';

export type AlloyDbIpType = 'PUBLIC' | 'PRIVATE' | 'PSC';

type ConnectInfo = {
  host: string;
  cert: string;
  key: string;
  ca: string;
  expiresAt: number;
};

type ConnectorState = {
  info: ConnectInfo | null;
  pending: Promise<ConnectInfo> | null;
  auth: GoogleAuth | null;
};

const g = globalThis as typeof globalThis & { __snagwalkAlloyConnector?: ConnectorState };
const state: ConnectorState = (g.__snagwalkAlloyConnector ??= { info: null, pending: null, auth: null });

function getAuth(): GoogleAuth {
  return (state.auth ??= new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }));
}

async function accessToken(): Promise<string> {
  const token = await getAuth().getAccessToken();
  if (!token) throw new Error('AlloyDB connector: could not obtain an OAuth2 access token (check ADC).');
  return token;
}

async function adminFetch<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`AlloyDB Admin API ${res.status}: ${body.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

async function fetchConnectInfo(instanceUri: string, ipType: AlloyDbIpType): Promise<ConnectInfo> {
  const clusterUri = instanceUri.replace(/\/instances\/[^/]+$/, '');
  if (clusterUri === instanceUri) throw new Error(`AlloyDB connector: invalid instance URI "${instanceUri}"`);

  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const [conn, certs] = await Promise.all([
    adminFetch<{ ipAddress?: string; publicIpAddress?: string; pscDnsName?: string }>(
      `${ADMIN_API}/${instanceUri}/connectionInfo`
    ),
    adminFetch<{ pemCertificateChain: string[]; caCert: string }>(`${ADMIN_API}/${clusterUri}:generateClientCertificate`, {
      method: 'POST',
      body: JSON.stringify({ publicKey, certDuration: `${CERT_TTL_SECONDS}s`, useMetadataExchange: true }),
    }),
  ]);

  const host =
    ipType === 'PUBLIC' ? conn.publicIpAddress : ipType === 'PSC' ? conn.pscDnsName?.replace(/\.$/, '') : conn.ipAddress;
  if (!host) throw new Error(`AlloyDB connector: instance has no ${ipType} address.`);

  return {
    host,
    cert: certs.pemCertificateChain.join('\n'),
    key: privateKey,
    ca: certs.caCert,
    expiresAt: Date.now() + CERT_TTL_SECONDS * 1000,
  };
}

async function getConnectInfo(instanceUri: string, ipType: AlloyDbIpType): Promise<ConnectInfo> {
  if (state.info && state.info.expiresAt - Date.now() > REFRESH_MARGIN_MS) return state.info;
  state.pending ??= fetchConnectInfo(instanceUri, ipType)
    .then((info) => (state.info = info))
    .finally(() => {
      state.pending = null;
    });
  return state.pending;
}

// --- protobuf (hand-encoded; three fields each way) -------------------------------------------

function encodeVarint(n: number): Buffer {
  const out: number[] = [];
  while (n > 0x7f) {
    out.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  out.push(n);
  return Buffer.from(out);
}

function encodeString(field: number, value: string): Buffer {
  const bytes = Buffer.from(value, 'utf8');
  return Buffer.concat([encodeVarint((field << 3) | 2), encodeVarint(bytes.length), bytes]);
}

/** MetadataExchangeRequest { user_agent = 1; auth_type = 2 (DB_NATIVE = 1); oauth2_token = 3 } */
function metadataRequest(token: string): Buffer {
  const body = Buffer.concat([
    encodeString(1, USER_AGENT),
    Buffer.from([(2 << 3) | 0, 1]),
    encodeString(3, token),
  ]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  return Buffer.concat([len, body]);
}

/** MetadataExchangeResponse { response_code = 1 (OK = 1, ERROR = 2); error = 2 } */
function parseMetadataResponse(buf: Buffer): { ok: boolean; error: string } {
  let i = 0;
  let code = 0;
  let error = '';
  const varint = () => {
    let result = 0;
    let shift = 0;
    for (;;) {
      const b = buf[i++];
      result |= (b & 0x7f) << shift;
      if (!(b & 0x80)) return result;
      shift += 7;
    }
  };
  while (i < buf.length) {
    const tag = varint();
    const field = tag >> 3;
    const wire = tag & 7;
    if (wire === 0) {
      const v = varint();
      if (field === 1) code = v;
    } else if (wire === 2) {
      const len = varint();
      if (field === 2) error = buf.subarray(i, i + len).toString('utf8');
      i += len;
    } else {
      break;
    }
  }
  return { ok: code === 1, error };
}

function readFrame(sock: tls.TLSSocket): Promise<{ frame: Buffer; rest: Buffer }> {
  return new Promise((resolve, reject) => {
    let acc = Buffer.alloc(0);
    const onData = (chunk: Buffer) => {
      acc = Buffer.concat([acc, chunk]);
      if (acc.length < 4) return;
      const len = acc.readUInt32BE(0);
      if (acc.length < 4 + len) return;
      cleanup();
      resolve({ frame: acc.subarray(4, 4 + len), rest: acc.subarray(4 + len) });
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const onClose = () => {
      cleanup();
      reject(new Error('AlloyDB connector: connection closed during metadata exchange'));
    };
    const cleanup = () => {
      sock.off('data', onData);
      sock.off('error', onError);
      sock.off('close', onClose);
    };
    sock.on('data', onData);
    sock.once('error', onError);
    sock.once('close', onClose);
  });
}

async function openSocket(instanceUri: string, ipType: AlloyDbIpType): Promise<{ sock: tls.TLSSocket; rest: Buffer }> {
  const info = await getConnectInfo(instanceUri, ipType);
  const sock = await new Promise<tls.TLSSocket>((resolve, reject) => {
    const s = tls.connect({
      host: info.host,
      port: SERVER_PORT,
      cert: info.cert,
      key: info.key,
      ca: info.ca,
      // The chain is verified against the cluster CA; the server cert is not issued for the IP/hostname.
      checkServerIdentity: () => undefined,
    });
    s.once('secureConnect', () => {
      s.off('error', reject);
      resolve(s);
    });
    s.once('error', reject);
  });
  sock.setNoDelay(true);

  const reply = readFrame(sock);
  sock.write(metadataRequest(await accessToken()));
  try {
    const { frame, rest } = await reply;
    const res = parseMetadataResponse(frame);
    if (!res.ok) throw new Error(`AlloyDB metadata exchange failed: ${res.error || 'unknown error'}`);
    return { sock, rest };
  } catch (err) {
    sock.destroy();
    throw err;
  }
}

/**
 * Socket-like Duplex handed to `pg` via the `stream` option. `pg` calls connect() and waits for
 * 'connect'; we do the async certificate + TLS + metadata work first, then relay bytes.
 */
class AlloyDbStream extends Duplex {
  private sock: tls.TLSSocket | null = null;
  private pending: Array<[Buffer, (err?: Error | null) => void]> = [];

  constructor(
    private readonly instanceUri: string,
    private readonly ipType: AlloyDbIpType
  ) {
    super();
  }

  connect(): this {
    openSocket(this.instanceUri, this.ipType).then(
      ({ sock, rest }) => {
        if (this.destroyed) {
          sock.destroy();
          return;
        }
        this.sock = sock;
        if (rest.length) this.push(rest);
        sock.on('data', (chunk: Buffer) => {
          if (!this.push(chunk)) sock.pause();
        });
        sock.on('end', () => this.push(null));
        sock.on('error', (err) => this.destroy(err));
        sock.on('close', () => this.destroy());
        for (const [chunk, cb] of this.pending.splice(0)) sock.write(chunk, cb);
        this.emit('connect');
      },
      (err: Error) => this.destroy(err)
    );
    return this;
  }

  _write(chunk: Buffer, _enc: BufferEncoding, cb: (err?: Error | null) => void) {
    if (this.sock) this.sock.write(chunk, cb);
    else this.pending.push([chunk, cb]);
  }

  _read() {
    this.sock?.resume();
  }

  _final(cb: (err?: Error | null) => void) {
    if (this.sock) this.sock.end(cb);
    else cb();
  }

  _destroy(err: Error | null, cb: (err: Error | null) => void) {
    this.sock?.destroy();
    cb(err);
  }

  // net.Socket API surface that pg touches.
  setNoDelay() {
    return this;
  }
  setKeepAlive(enable?: boolean, delay?: number) {
    this.sock?.setKeepAlive(enable, delay);
    return this;
  }
  ref() {
    this.sock?.ref();
    return this;
  }
  unref() {
    this.sock?.unref();
    return this;
  }
}

export function alloyDbStreamFactory(instanceUri: string, ipType: AlloyDbIpType = 'PUBLIC') {
  return () => new AlloyDbStream(instanceUri, ipType);
}
