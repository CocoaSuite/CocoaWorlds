/**
 * A layered Photoshop file from RGBA pictures of one size (uncompressed, 8-bit RGB). The first layer given is
 * the top one; every layer is visible. Opens in Photoshop, Photopea, Krita, Procreate and Affinity.
 */
export interface PsdLayer {
  name: string;
  /** RGBA, top row first, `size × size`. */
  px: Uint8Array;
  hidden?: boolean;
}

class Out {
  private parts: Uint8Array[] = [];
  length = 0;
  bytes(b: Uint8Array) {
    this.parts.push(b);
    this.length += b.length;
  }
  u8(v: number) {
    this.bytes(Uint8Array.of(v & 255));
  }
  u16(v: number) {
    this.bytes(Uint8Array.of((v >> 8) & 255, v & 255));
  }
  i16(v: number) {
    this.u16(v < 0 ? 0x10000 + v : v);
  }
  u32(v: number) {
    this.bytes(Uint8Array.of((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255));
  }
  ascii(s: string) {
    this.bytes(new TextEncoder().encode(s));
  }
  done(): Uint8Array {
    const all = new Uint8Array(this.length);
    let o = 0;
    for (const p of this.parts) {
      all.set(p, o);
      o += p.length;
    }
    return all;
  }
}

/** One channel of RGBA pixels (0..3). */
function plane(px: Uint8Array, c: number, n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = px[i * 4 + c]!;
  return out;
}

/** A Pascal string padded to a multiple of 4 (layer names). */
function pascal4(name: string): Uint8Array {
  const raw = [...name].map((ch) => (ch.charCodeAt(0) < 128 ? ch.charCodeAt(0) : 63)).slice(0, 255);
  const len = Math.ceil((raw.length + 1) / 4) * 4;
  const b = new Uint8Array(len);
  b[0] = raw.length;
  b.set(raw, 1);
  return b;
}

/** The layer name in full (Unicode), as Photoshop's `luni` block. */
function unicodeName(name: string): Uint8Array {
  const o = new Out();
  o.ascii('8BIM');
  o.ascii('luni');
  const chars = [...name].map((c) => c.charCodeAt(0));
  const body = 4 + chars.length * 2;
  const padded = body + (body % 4 ? 4 - (body % 4) : 0);
  o.u32(padded);
  o.u32(chars.length);
  for (const c of chars) o.u16(c);
  for (let i = body; i < padded; i++) o.u8(0);
  return o.done();
}

export function buildPsd(size: number, layers: PsdLayer[]): Uint8Array {
  const n = size * size;
  const o = new Out();
  // Header.
  o.ascii('8BPS');
  o.u16(1);
  o.bytes(new Uint8Array(6));
  o.u16(3); // channels in the merged picture
  o.u32(size);
  o.u32(size);
  o.u16(8);
  o.u16(3); // RGB
  o.u32(0); // colour mode data
  o.u32(0); // image resources

  // Layer records, bottom layer first (Photoshop's order).
  const order = [...layers].reverse();
  const info = new Out();
  info.i16(order.length);
  const chans = [-1, 0, 1, 2];
  const chanLen = 2 + n; // compression word + raw data
  for (const l of order) {
    info.u32(0);
    info.u32(0);
    info.u32(size);
    info.u32(size);
    info.u16(chans.length);
    for (const c of chans) {
      info.i16(c);
      info.u32(chanLen);
    }
    info.ascii('8BIM');
    info.ascii('norm');
    info.u8(255); // opacity
    info.u8(0); // clipping
    info.u8(l.hidden ? 2 : 0); // flags: bit 1 = hidden
    info.u8(0);
    const name = pascal4(l.name);
    const uni = unicodeName(l.name);
    info.u32(4 + 4 + name.length + uni.length); // extra data
    info.u32(0); // mask
    info.u32(0); // blending ranges
    info.bytes(name);
    info.bytes(uni);
  }
  for (const l of order) {
    for (const c of chans) {
      info.u16(0); // raw
      info.bytes(plane(l.px, c === -1 ? 3 : c, n));
    }
  }
  if (info.length % 2) info.u8(0);
  const infoBytes = info.done();
  o.u32(4 + infoBytes.length + 4); // layer and mask section
  o.u32(infoBytes.length);
  o.bytes(infoBytes);
  o.u32(0); // global mask

  // The merged picture: the top visible layer.
  const top = layers.find((l) => !l.hidden) ?? layers[0];
  o.u16(0);
  for (let c = 0; c < 3; c++) o.bytes(top ? plane(top.px, c, n) : new Uint8Array(n));
  return o.done();
}
