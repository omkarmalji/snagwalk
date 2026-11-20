import { describe, expect, it } from 'vitest';
import { metadataRequest, parseMetadataResponse } from './alloydb-connector';

/** Minimal protobuf reader for the test: field number -> raw value. */
function decodeFields(buf: Buffer): Map<number, string | number> {
  const out = new Map<number, string | number>();
  let i = 0;
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
    if ((tag & 7) === 0) out.set(tag >> 3, varint());
    else {
      const len = varint();
      out.set(tag >> 3, buf.subarray(i, i + len).toString('utf8'));
      i += len;
    }
  }
  return out;
}

describe('AlloyDB metadata exchange', () => {
  it('frames the request with a big-endian length prefix', () => {
    const frame = metadataRequest('ya29.token');
    expect(frame.readUInt32BE(0)).toBe(frame.length - 4);
  });

  it('encodes user agent, DB_NATIVE auth type and the OAuth token', () => {
    const fields = decodeFields(metadataRequest('ya29.token').subarray(4));
    expect(fields.get(1)).toMatch(/^snagwalk-alloydb-connector\//);
    expect(fields.get(2)).toBe(1); // AuthType.DB_NATIVE
    expect(fields.get(3)).toBe('ya29.token');
  });

  it('encodes long tokens with multi-byte varint lengths', () => {
    const token = 't'.repeat(1500);
    expect(decodeFields(metadataRequest(token).subarray(4)).get(3)).toBe(token);
  });

  it('parses an OK response', () => {
    expect(parseMetadataResponse(Buffer.from([0x08, 0x01]))).toEqual({ ok: true, error: '' });
  });

  it('parses an ERROR response with its message', () => {
    const msg = Buffer.from('IAM denied', 'utf8');
    const buf = Buffer.concat([Buffer.from([0x08, 0x02, 0x12, msg.length]), msg]);
    expect(parseMetadataResponse(buf)).toEqual({ ok: false, error: 'IAM denied' });
  });
});
