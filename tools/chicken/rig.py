"""Rig and animate the chicken: re-orient (face -Z, feet at the origin), add a skeleton with smooth weights, and
author clumsy animations (idle, walk, run, peck, flap, die). Writes a new GLB next to the input."""
import json, struct, sys, math
import numpy as np
sys.path.insert(0, '.')
from glb import load, acc

SRC, OUT = sys.argv[1], sys.argv[2]
j, b = load(SRC)
buf = bytearray(b)


def pad4():
    while len(buf) % 4:
        buf.append(0)


def add_view(data: bytes, target=None):
    pad4()
    off = len(buf)
    buf.extend(data)
    v = {'buffer': 0, 'byteOffset': off, 'byteLength': len(data)}
    if target:
        v['target'] = target
    j['bufferViews'].append(v)
    return len(j['bufferViews']) - 1


def add_acc(arr, ctype, typ, target=None, minmax=False, normalized=False):
    arr = np.ascontiguousarray(arr)
    view = add_view(arr.tobytes(), target)
    a = {'bufferView': view, 'componentType': ctype, 'count': int(arr.shape[0]), 'type': typ}
    if normalized:
        a['normalized'] = True
    if minmax:
        a['min'] = [float(x) for x in arr.min(0)]
        a['max'] = [float(x) for x in arr.max(0)]
    j['accessors'].append(a)
    return len(j['accessors']) - 1


# ── Re-orientation: old +X (the beak) becomes -Z; feet on y = 0, centred between the feet. ──
FEET_X = -0.15  # old x of the middle of the feet
FEET_Y = -1.67


def to_new(p):
    x, y, z = p[:, 0], p[:, 1], p[:, 2]
    return np.stack([z, y - FEET_Y, -(x - FEET_X)], 1).astype(np.float32)


def rot_n(n):
    x, y, z = n[:, 0], n[:, 1], n[:, 2]
    return np.stack([z, y, -x], 1).astype(np.float32)


def P(x, y, z):
    """An old-coordinates point in new coordinates."""
    return np.array([z, y - FEET_Y, -(x - FEET_X)], np.float32)


# ── Skeleton (new coordinates: forward -Z, right +X, up +Y) ──
BONES = [
    # name, parent, head position (old coords)
    ('root', None, (FEET_X, FEET_Y, 0)),
    ('body', 'root', (-0.2, -0.3, 0)),
    ('neck', 'body', (0.2, 0.25, 0)),
    ('head', 'neck', (0.45, 0.65, 0)),
    ('tail', 'body', (-0.7, 0.2, 0)),
    ('wing.R', 'body', (-0.15, 0.15, 0.55)),
    ('wing.L', 'body', (-0.15, 0.15, -0.55)),
    ('leg.R', 'body', (-0.3, -0.88, 0.3)),
    ('foot.R', 'leg.R', (-0.32, -1.52, 0.3)),
    ('leg.L', 'body', (-0.3, -0.88, -0.3)),
    ('foot.L', 'leg.L', (-0.32, -1.52, -0.3)),
]
NAMES = [b[0] for b in BONES]
IDX = {n: i for i, n in enumerate(NAMES)}
POS = {n: P(*p) for n, _, p in BONES}


def ss(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def weights(Pold, orange, whole_head=False):
    x, y, z = Pold[:, 0], Pold[:, 1], Pold[:, 2]
    n = len(x)
    W = np.zeros((n, len(NAMES)), np.float32)
    if whole_head:
        W[:, IDX['head']] = 1
        return W
    az = np.abs(z)
    head = ss(0.3, 0.5, y) * ss(0.05, 0.3, x)
    neck = ss(0.0, 0.3, y) * ss(-0.1, 0.15, x) * (1 - head)
    tail = ss(-0.6, -0.85, x) * ss(-0.15, 0.15, y)
    wing = ss(0.56, 0.66, az) * ss(-0.65, -0.45, y) * (1 - ss(0.35, 0.5, y))
    legs = orange * (y < -0.8)
    leg = ss(-0.82, -0.95, y) * (legs > 0) + 0.0
    foot = ss(-1.42, -1.52, y) * (legs > 0)
    leg = leg * (1 - foot)
    rest = np.clip(1 - head - neck - tail - wing - leg - foot, 0, 1)
    W[:, IDX['head']] = head
    W[:, IDX['neck']] = neck
    W[:, IDX['tail']] = tail
    right = z > 0
    W[:, IDX['wing.R']] = wing * right
    W[:, IDX['wing.L']] = wing * ~right
    W[:, IDX['leg.R']] = leg * right
    W[:, IDX['leg.L']] = leg * ~right
    W[:, IDX['foot.R']] = foot * right
    W[:, IDX['foot.L']] = foot * ~right
    W[:, IDX['body']] = rest
    W /= W.sum(1, keepdims=True)
    return W


def top4(W):
    order = np.argsort(-W, 1)[:, :4]
    w = np.take_along_axis(W, order, 1)
    w /= w.sum(1, keepdims=True)
    # (Unused slots point at bone 0 with no weight.)
    order = np.where(w > 0, order, 0)
    return order.astype(np.uint8), w.astype(np.float32)


mesh = j['meshes'][0]
for pi, prim in enumerate(mesh['primitives']):
    a = prim['attributes']
    Pold = acc(j, b, a['POSITION']).astype(np.float32)
    Nold = acc(j, b, a['NORMAL']).astype(np.float32)
    col1 = acc(j, b, a['COLOR_1'])
    orange = (col1[:, 0] > 0.5).astype(np.float32)
    W = weights(Pold, orange, whole_head=(pi < 2))  # the eyes go with the head
    J, Wt = top4(W)
    a['POSITION'] = add_acc(to_new(Pold), 5126, 'VEC3', 34962, minmax=True)
    a['NORMAL'] = add_acc(rot_n(Nold), 5126, 'VEC3', 34962)
    a['JOINTS_0'] = add_acc(J, 5121, 'VEC4', 34962)
    a['WEIGHTS_0'] = add_acc(Wt, 5126, 'VEC4', 34962)
    # (COLOR_1 was a painting mask; nothing reads it in the engine.)
    a.pop('COLOR_1', None)

REST_FOLD, REST_FLAT = 0, 0.25  # (the same as FOLD and FLAT below)

# ── Nodes: a root "Chicken" holding the bones and the skinned mesh ──
nodes = []
node_of = {}
for name, parent, _ in BONES:
    t = POS[name] - (POS[parent] if parent else 0)
    node_of[name] = len(nodes) + 1  # (node 0 is the Chicken root)
    node = {'name': name, 'translation': [float(v) for v in t]}
    nodes.append(node)
for name, parent, _ in BONES:
    if parent:
        nodes[node_of[parent] - 1].setdefault('children', []).append(node_of[name])
# (Shown folded when nothing is playing, as in the editor.)
for _side, _name in ((1, 'wing.R'), (-1, 'wing.L')):
    _h = math.radians(-_side * REST_FOLD) / 2
    nodes[node_of[_name] - 1]['rotation'] = [0.0, 0.0, math.sin(_h), math.cos(_h)]
    nodes[node_of[_name] - 1]['scale'] = [REST_FLAT, 1.0, 1.0]
mesh_node = {'name': 'Chicken_mesh', 'mesh': 0, 'skin': 0}
all_nodes = [{'name': 'Chicken', 'children': [node_of['root']]}] + nodes + [mesh_node]
j['nodes'] = all_nodes
# (The skinned mesh sits at the top level, as glTF prefers.)
j['scenes'] = [{'name': 'Scene', 'nodes': [0, len(nodes) + 1]}]
j['scene'] = 0
ibm = np.zeros((len(NAMES), 16), np.float32)
for i, n in enumerate(NAMES):
    m = np.eye(4, dtype=np.float32)
    m[:3, 3] = -POS[n]
    ibm[i] = m.T.reshape(16)  # column-major
j['skins'] = [{'name': 'ChickenRig', 'joints': [node_of[n] for n in NAMES], 'skeleton': node_of['root'], 'inverseBindMatrices': add_acc(ibm, 5126, 'MAT4')}]

# ── Animations ──
FPS = 30


def quat(axis, deg):
    ax = np.array(axis, float)
    ax /= np.linalg.norm(ax)
    h = math.radians(deg) / 2
    return np.array([*(ax * math.sin(h)), math.cos(h)])


def qmul(a, b):
    x1, y1, z1, w1 = a
    x2, y2, z2, w2 = b
    return np.array([w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2, w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2, w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2, w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2])


def rot(x=0, y=0, z=0):
    """Euler degrees about X (pitch: + tips the top backwards), Y (yaw), Z (roll: + lifts the right side)."""
    return qmul(qmul(quat([0, 1, 0], y), quat([1, 0, 0], x)), quat([0, 0, 1], z))


def clip(name, length, tracks):
    """tracks: {bone: {'r': f(t)->quat, 't': f(t)->offset}} sampled at FPS (inclusive of the end, for loops)."""
    n = int(round(length * FPS)) + 1
    times = np.linspace(0, length, n).astype(np.float32)
    tacc = add_acc(times.reshape(-1, 1), 5126, 'SCALAR', minmax=True)
    samplers, channels = [], []
    for bone, tr in tracks.items():
        for path, f in tr.items():
            if path == 'r':
                vals = np.array([f(float(t)) for t in times], np.float32)
                # Keep neighbouring quaternions on the same side (no flips while interpolating).
                for i in range(1, len(vals)):
                    if np.dot(vals[i], vals[i - 1]) < 0:
                        vals[i] = -vals[i]
                out = add_acc(vals, 5126, 'VEC4')
                gp = 'rotation'
            elif path == 's':
                vals = np.array([f(float(t)) for t in times], np.float32)
                out = add_acc(vals, 5126, 'VEC3')
                gp = 'scale'
            else:
                base = POS[bone] - (POS[dict((b[0], b[1]) for b in BONES)[bone]] if dict((b[0], b[1]) for b in BONES)[bone] else 0)
                vals = np.array([base + np.array(f(float(t))) for t in times], np.float32)
                out = add_acc(vals, 5126, 'VEC3')
                gp = 'translation'
            samplers.append({'input': tacc, 'output': out, 'interpolation': 'LINEAR'})
            channels.append({'sampler': len(samplers) - 1, 'target': {'node': node_of[bone], 'path': gp}})
    j.setdefault('animations', []).append({'name': name, 'samplers': samplers, 'channels': channels})


S = math.sin
TAU = math.tau

# Wings rest pressed against the body: squashed flat towards it (scaled along the
# bone's outward axis). Animations give a raise in degrees; raising also unfolds the wing to full size.
FOLD = 0       # degrees tipped down at rest (flattening alone reads best on this mesh)
FLAT = 0.25    # outward thickness at rest (1 = as modelled)
OPEN = 45      # degrees of raise at which the wing is fully unfolded


def wing(side, raise_, x=0.0):
    """side +1 = wing.R (+X), -1 = wing.L. Returns the bone's rotation and scale tracks."""
    def opened(t):
        o = min(1.0, max(0.0, raise_(t) / OPEN))
        return o * o * (3 - 2 * o)
    return {
        'r': lambda t: rot(z=side * (-FOLD + raise_(t)), x=x),
        's': lambda t: (FLAT + (1 - FLAT) * opened(t), 1.0, 1.0),
    }


def snap(keys, t, period=None):
    """Stepped values with quick (0.07 s) moves between them: chickens move their heads in jerks."""
    if period:
        t = t % period
    v = keys[0][1]
    for i, (k, val) in enumerate(keys):
        if t >= k:
            prev = keys[i - 1][1] if i else val
            v = prev + (val - prev) * min(1, (t - k) / 0.07)
    return v


# Idle (3 s): breathing, jerky looks about, a tail shake, a wing fidget.
look = [(0, 0), (0.6, 28), (1.3, -18), (1.8, -18), (2.2, 8), (2.7, 0)]
tilt = [(0, 0), (0.6, -12), (1.3, 10), (2.2, 0)]
clip('idle', 3.0, {
    'body': {'t': lambda t: (0, 0.02 * S(TAU * t / 1.5), 0), 'r': lambda t: rot(x=2 * S(TAU * t / 1.5))},
    'neck': {'r': lambda t: rot(y=snap(look, t) * 0.4, x=3 * S(TAU * t / 1.5))},
    'head': {'r': lambda t: rot(y=snap(look, t) * 0.6, z=snap(tilt, t))},
    'tail': {'r': lambda t: rot(z=(14 * S(TAU * t * 8) * max(0, 1 - abs(t - 2.45) / 0.2)))},
    'wing.R': wing(1, lambda t: 12 * max(0, 1 - abs(t - 1.0) / 0.15)),
    'wing.L': wing(-1, lambda t: 6 * max(0, 1 - abs(t - 1.1) / 0.12)),
})

# Walk (0.7 s a cycle): a gentle waddle, the head bobbing forward and back (the chicken's own walk), wings
# folded, legs swinging; a little off-beat for clumsiness.
W = 0.7
clip('walk', W, {
    'root': {'t': lambda t: (0, 0, 0)},
    'body': {
        't': lambda t: (0.008 * S(TAU * t / W), 0.04 * abs(S(TAU * t / W)), 0),
        'r': lambda t: rot(x=-6 + 2.5 * S(2 * TAU * t / W), z=3 * S(TAU * t / W), y=2 * S(TAU * t / W + 0.6)),
    },
    'neck': {'r': lambda t: rot(x=-10 * S(2 * TAU * t / W) - 4, z=-2 * S(TAU * t / W))},
    'head': {'r': lambda t: rot(x=12 * S(2 * TAU * t / W + 0.5), z=-1.5 * S(TAU * t / W))},
    'tail': {'r': lambda t: rot(y=-5 * S(TAU * t / W), x=-5)},
    'wing.R': wing(1, lambda t: 2 + 2 * S(2 * TAU * t / W)),
    'wing.L': wing(-1, lambda t: 2 + 2 * S(2 * TAU * t / W + 0.3)),
    'leg.R': {'r': lambda t: rot(x=32 * S(TAU * t / W))},
    'foot.R': {'r': lambda t: rot(x=-25 * max(0, S(TAU * t / W + 0.8)))},
    'leg.L': {'r': lambda t: rot(x=-32 * S(TAU * t / W))},
    'foot.L': {'r': lambda t: rot(x=-25 * max(0, -S(TAU * t / W + 0.8)))},
})

# Run (0.4 s): leaning far forward, wings flailing, neck stretched, legs a blur, a lurch every other step.
R = 0.4
clip('run', R, {
    'body': {
        't': lambda t: (0.05 * S(TAU * t / R), 0.12 * abs(S(TAU * t / R)), 0),
        'r': lambda t: rot(x=-22 + 5 * S(2 * TAU * t / R), z=5 * S(TAU * t / R), y=4 * S(TAU * t / R)),
    },
    'neck': {'r': lambda t: rot(x=10 + 6 * S(2 * TAU * t / R))},
    'head': {'r': lambda t: rot(x=8 * S(2 * TAU * t / R + 1), z=10 * S(TAU * t / R))},
    'tail': {'r': lambda t: rot(x=-20, y=-15 * S(TAU * t / R))},
    'wing.R': wing(1, lambda t: 35 + 30 * S(2 * TAU * t / R)),
    'wing.L': wing(-1, lambda t: 35 + 30 * S(2 * TAU * t / R + 0.4)),
    'leg.R': {'r': lambda t: rot(x=50 * S(TAU * t / R))},
    'foot.R': {'r': lambda t: rot(x=-40 * max(0, S(TAU * t / R + 0.8)))},
    'leg.L': {'r': lambda t: rot(x=-50 * S(TAU * t / R))},
    'foot.L': {'r': lambda t: rot(x=-40 * max(0, -S(TAU * t / R + 0.8)))},
})


def peck_curve(t):
    """Two jabs: a big one that overshoots, then a smaller one."""
    a = max(0.0, 1 - abs(t - 0.22) / 0.14)
    b = max(0.0, 1 - abs(t - 0.46) / 0.1) * 0.7
    return max(a, b)


# Peck (0.7 s): tips forward and jabs twice at the ground (or the player's ankles).
clip('peck', 0.7, {
    'body': {'r': lambda t: rot(x=-30 * min(1, t / 0.15) * (1 - max(0, (t - 0.55) / 0.15)))},
    'neck': {'r': lambda t: rot(x=-55 * peck_curve(t))},
    'head': {'r': lambda t: rot(x=-25 * peck_curve(t), z=8 * S(TAU * t * 3))},
    'tail': {'r': lambda t: rot(x=-25 * min(1, t / 0.15) * (1 - max(0, (t - 0.55) / 0.15)))},
    'wing.R': wing(1, lambda t: 20 * peck_curve(t)),
    'wing.L': wing(-1, lambda t: 20 * peck_curve(t)),
})

# Flap (0.5 s): startled: a hop with the wings beating.
clip('flap', 0.5, {
    'root': {'t': lambda t: (0, 0.35 * S(math.pi * t / 0.5), 0)},
    'body': {'r': lambda t: rot(x=10 * S(math.pi * t / 0.5))},
    'neck': {'r': lambda t: rot(x=15 * S(math.pi * t / 0.5))},
    'wing.R': wing(1, lambda t: 35 + 35 * S(TAU * t / 0.125)),
    'wing.L': wing(-1, lambda t: 35 + 35 * S(TAU * t / 0.125)),
    'leg.R': {'r': lambda t: rot(x=20 * S(math.pi * t / 0.5))},
    'leg.L': {'r': lambda t: rot(x=-15 * S(math.pi * t / 0.5))},
})


def ease(t, a, b):
    k = min(1, max(0, (t - a) / (b - a)))
    return k * k * (3 - 2 * k)


# Die (1.4 s): a last flap, keels over onto its side with a bounce, legs stiff in the air.
def roll(t):
    k = ease(t, 0.35, 0.8)
    bounce = 8 * S(min(1, max(0, (t - 0.8) / 0.3)) * math.pi) * (t > 0.8)
    return 88 * k - bounce


clip('die', 1.4, {
    'root': {'r': lambda t: rot(z=roll(t)), 't': lambda t: (0.45 * ease(t, 0.35, 0.8), 0.2 * S(min(1, t / 0.4) * math.pi) * (t < 0.4), 0)},
    'body': {'r': lambda t: rot(x=10 * ease(t, 0.3, 0.8))},
    'neck': {'r': lambda t: rot(x=-30 * ease(t, 0.6, 1.0), z=25 * ease(t, 0.7, 1.1))},
    'head': {'r': lambda t: rot(x=-25 * ease(t, 0.7, 1.1))},
    'wing.R': wing(1, lambda t: (25 + 45 * S(TAU * t / 0.14)) * (t < 0.42) + 25 * ease(t, 0.6, 1.0)),
    'wing.L': wing(-1, lambda t: (25 + 45 * S(TAU * t / 0.14)) * (t < 0.42) + 15 * ease(t, 0.6, 1.0)),
    'leg.R': {'r': lambda t: rot(x=-25 * ease(t, 0.8, 1.0), z=-15 * ease(t, 0.8, 1.0))},
    'leg.L': {'r': lambda t: rot(x=30 * ease(t, 0.8, 1.0), z=10 * ease(t, 0.8, 1.0))},
    'foot.R': {'r': lambda t: rot(x=-40 * ease(t, 0.85, 1.05))},
    'foot.L': {'r': lambda t: rot(x=-40 * ease(t, 0.85, 1.05))},
})

# ── Keep only what is used (the old positions and normals go) ──
used_acc = set()
for prim in j['meshes'][0]['primitives']:
    used_acc |= set(prim['attributes'].values())
    used_acc.add(prim['indices'])
used_acc.add(j['skins'][0]['inverseBindMatrices'])
for an in j['animations']:
    for sm in an['samplers']:
        used_acc |= {sm['input'], sm['output']}
used_views = {j['accessors'][i]['bufferView'] for i in used_acc} | {im['bufferView'] for im in j['images']}
newbuf = bytearray()
view_map = {}
new_views = []
for vi in sorted(used_views):
    v = j['bufferViews'][vi]
    while len(newbuf) % 4:
        newbuf.append(0)
    data = buf[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']]
    nv = dict(v, byteOffset=len(newbuf))
    newbuf.extend(data)
    view_map[vi] = len(new_views)
    new_views.append(nv)
acc_map = {}
new_acc = []
for ai in sorted(used_acc):
    acc_map[ai] = len(new_acc)
    new_acc.append(dict(j['accessors'][ai], bufferView=view_map[j['accessors'][ai]['bufferView']]))
for prim in j['meshes'][0]['primitives']:
    prim['attributes'] = {k: acc_map[v] for k, v in prim['attributes'].items()}
    prim['indices'] = acc_map[prim['indices']]
j['skins'][0]['inverseBindMatrices'] = acc_map[j['skins'][0]['inverseBindMatrices']]
for an in j['animations']:
    for sm in an['samplers']:
        sm['input'], sm['output'] = acc_map[sm['input']], acc_map[sm['output']]
for im in j['images']:
    im['bufferView'] = view_map[im['bufferView']]
j['accessors'], j['bufferViews'] = new_acc, new_views
buf = newbuf
j['buffers'] = [{'byteLength': len(buf)}]
j['asset']['generator'] = 'CocoaWorlds chicken rig'

js = json.dumps(j, separators=(',', ':')).encode()
while len(js) % 4:
    js += b' '
pad4()
out = bytearray()
total = 12 + 8 + len(js) + 8 + len(buf)
out += struct.pack('<4sII', b'glTF', 2, total)
out += struct.pack('<I4s', len(js), b'JSON') + js
out += struct.pack('<I4s', len(buf), b'BIN\x00') + buf
open(OUT, 'wb').write(out)
print('wrote', OUT, len(out), 'bytes;', len(j['animations']), 'animations:', [a['name'] for a in j['animations']])
