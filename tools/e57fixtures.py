"""Writes the E57 test files of src/core/test/fixtures/e57 with libE57Format (pye57),
the reference implementation, and what a reader has to get out of them.

    python tools/e57fixtures.py            # the small fixtures, kept in the repository
    python tools/e57fixtures.py LAZ OUT    # a LAZ file as E57 (the sample cloud)

Needs `pip install pye57 numpy` (and `laspy[lazrs]` for the second form). The
expected points are computed here with numpy from the values written: pose
applied (rotation as a unit quaternion, then translation), spherical
coordinates turned Cartesian, invalid points left out, intensity on 0…65535
between its limits.
"""
import json
import os
import sys

import numpy as np
from pye57 import libe57

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'src', 'test', 'fixtures', 'e57')


def quat_matrix(w, x, y, z):
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
        [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
        [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
    ])


class Writer:
    def __init__(self, path, coordinate_metadata=''):
        self.f = libe57.ImageFile(path, 'w')
        root = self.f.root()
        root.set('formatName', libe57.StringNode(self.f, 'ASTM E57 3D Imaging Data File'))
        root.set('guid', libe57.StringNode(self.f, '{olt-fixture}'))
        root.set('versionMajor', libe57.IntegerNode(self.f, 1))
        root.set('versionMinor', libe57.IntegerNode(self.f, 0))
        root.set('coordinateMetadata', libe57.StringNode(self.f, coordinate_metadata))
        self.data3d = libe57.VectorNode(self.f, True)
        root.set('data3D', self.data3d)
        root.set('images2D', libe57.VectorNode(self.f, True))

    def scan(self, name, fields, data, rotation=(1, 0, 0, 0), translation=(0, 0, 0), bounds=None, intensity_limits=None,
             color_limits=None):
        """`fields`: [(name, node factory)], `data`: {name: numpy array}."""
        f = self.f
        scan = libe57.StructureNode(f)
        scan.set('guid', libe57.StringNode(f, '{' + name + '}'))
        scan.set('name', libe57.StringNode(f, name))
        pose = libe57.StructureNode(f)
        rot = libe57.StructureNode(f)
        for k, v in zip('wxyz', rotation):
            rot.set(k, libe57.FloatNode(f, float(v)))
        tr = libe57.StructureNode(f)
        for k, v in zip('xyz', translation):
            tr.set(k, libe57.FloatNode(f, float(v)))
        pose.set('rotation', rot)
        pose.set('translation', tr)
        scan.set('pose', pose)
        if bounds is not None:
            b = libe57.StructureNode(f)
            for k, v in zip(['xMinimum', 'xMaximum', 'yMinimum', 'yMaximum', 'zMinimum', 'zMaximum'], bounds):
                b.set(k, libe57.FloatNode(f, float(v)))
            scan.set('cartesianBounds', b)
        if intensity_limits is not None:
            il = libe57.StructureNode(f)
            il.set('intensityMinimum', libe57.FloatNode(f, float(intensity_limits[0])))
            il.set('intensityMaximum', libe57.FloatNode(f, float(intensity_limits[1])))
            scan.set('intensityLimits', il)
        if color_limits is not None:
            cl = libe57.StructureNode(f)
            for c in ('Red', 'Green', 'Blue'):
                cl.set(f'color{c}Minimum', libe57.IntegerNode(f, int(color_limits[0])))
                cl.set(f'color{c}Maximum', libe57.IntegerNode(f, int(color_limits[1])))
            scan.set('colorLimits', cl)
        proto = libe57.StructureNode(f)
        for fname, make in fields:
            proto.set(fname, make(f))
        points = libe57.CompressedVectorNode(f, proto, libe57.VectorNode(f, True))
        scan.set('points', points)
        self.data3d.append(scan)
        n = len(next(iter(data.values())))
        buffers = libe57.VectorSourceDestBuffer()
        arrays = []
        for fname, _ in fields:
            a = np.ascontiguousarray(data[fname])
            if a.dtype.kind in 'iu' and a.dtype.char not in 'bBhH':
                # The binding reads wider integer buffers as 32 bits a value.
                a = a.astype(np.int16 if a.min() >= -32768 and a.max() < 32768 else np.uint16)
            arrays.append(a)
            buffers.append(libe57.SourceDestBuffer(f, fname, a, n, True, True))
        w = points.writer(buffers)
        w.write(n)
        w.close()

    def close(self):
        self.f.close()


def scaled(lo, hi, scale, offset=0.0):
    return lambda f: libe57.ScaledIntegerNode(f, int(lo), int(lo), int(hi), scale, offset)


def integer(lo, hi):
    return lambda f: libe57.IntegerNode(f, int(lo), int(lo), int(hi))


def flt(single=False, lo=None, hi=None):
    precision = libe57.E57_SINGLE if single else libe57.E57_DOUBLE
    if lo is None:
        return lambda f: libe57.FloatNode(f, 0.0, precision)
    return lambda f: libe57.FloatNode(f, float(lo), precision, float(lo), float(hi))


def to_global(xyz, rotation, translation):
    return xyz @ quat_matrix(*rotation).T + np.asarray(translation, dtype=float)


def expectation(points, intensity, every):
    """What the test compares: count, sums, and every `every`-th point."""
    idx = np.arange(0, len(points), every)
    return {
        'count': int(len(points)),
        'sum': [float(points[:, 0].sum()), float(points[:, 1].sum()), float(points[:, 2].sum())],
        'intensitySum': None if intensity is None else int(intensity.sum()),
        'min': points.min(axis=0).tolist(),
        'max': points.max(axis=0).tolist(),
        'sample': [[int(i), *points[i].tolist(), None if intensity is None else int(intensity[i])] for i in idx],
    }


def norm16(v, lo, hi):
    return np.floor((v - lo) / (hi - lo) * 65535 + 0.5).clip(0, 65535).astype(np.int64)


def fixtures():
    rng = np.random.default_rng(57)
    os.makedirs(OUT, exist_ok=True)
    expected = {}

    # 1 — scaled integers of odd widths, a turned and shifted pose, invalid points,
    # a colour channel that has to be stepped over, integer intensity.
    n = 30000
    scale = 0.0001
    raw = np.stack([rng.integers(-300000, 300000, n), rng.integers(-150000, 150000, n), rng.integers(-20000, 40000, n)], axis=1)
    state = np.where(rng.random(n) < 0.05, 2, 0).astype(np.int8)
    inten = rng.integers(0, 2048, n).astype(np.int32)
    red = rng.integers(0, 256, n).astype(np.uint8)
    rot = (np.cos(np.radians(15)), 0.0, 0.0, np.sin(np.radians(15)))   # 30° about z
    tr = (4470687.25, 5332208.5, 530.125)
    w = Writer(os.path.join(OUT, 'scaled_pose.e57'), 'EPSG:5678')
    w.scan('scaled', [
        ('cartesianX', scaled(-300000, 300000, scale)),
        ('cartesianY', scaled(-150000, 150000, scale)),
        ('cartesianZ', scaled(-20000, 40000, scale)),
        ('cartesianInvalidState', integer(0, 2)),
        ('colorRed', integer(0, 255)),
        ('intensity', integer(0, 2047)),
    ], {
        'cartesianX': raw[:, 0] * scale, 'cartesianY': raw[:, 1] * scale, 'cartesianZ': raw[:, 2] * scale,
        'cartesianInvalidState': state, 'colorRed': red, 'intensity': inten,
    }, rotation=rot, translation=tr, bounds=[-30, 30, -15, 15, -2, 4], intensity_limits=(0, 2047))
    w.close()
    keep = state == 0
    pts = to_global(raw[keep] * scale, rot, tr)
    expected['scaled_pose.e57'] = expectation(pts, norm16(inten[keep], 0, 2047), 997)

    # 2 — two scans: spherical in doubles with float intensity, then Cartesian in
    # singles without intensity; each its own pose.
    n1 = 6000
    rng_ = rng.uniform(1, 60, n1)
    az = rng.uniform(-np.pi, np.pi, n1)
    el = rng.uniform(-0.6, 0.9, n1)
    sstate = np.where(rng.random(n1) < 0.03, 1, 0).astype(np.int8)
    fint = rng.uniform(0, 1, n1).astype(np.float32)
    rot1 = (np.cos(0.2), np.sin(0.2) * 0.6, 0.0, np.sin(0.2) * 0.8)
    tr1 = (691234.5, 5712345.25, 101.0)
    n2 = 6000
    xyz2 = rng.uniform(-20, 20, (n2, 3)).astype(np.float32)
    rot2 = (1.0, 0.0, 0.0, 0.0)
    tr2 = (691250.0, 5712350.0, 100.0)
    w = Writer(os.path.join(OUT, 'spherical_two_scans.e57'))
    w.scan('spherical', [
        ('sphericalRange', flt()),
        ('sphericalAzimuth', flt()),
        ('sphericalElevation', flt()),
        ('sphericalInvalidState', integer(0, 2)),
        ('intensity', flt(True, 0, 1)),
    ], {
        'sphericalRange': rng_, 'sphericalAzimuth': az, 'sphericalElevation': el,
        'sphericalInvalidState': sstate, 'intensity': fint,
    }, rotation=rot1, translation=tr1)
    w.scan('cartesian', [
        ('cartesianX', flt(True)), ('cartesianY', flt(True)), ('cartesianZ', flt(True)),
    ], {'cartesianX': xyz2[:, 0], 'cartesianY': xyz2[:, 1], 'cartesianZ': xyz2[:, 2]},
        rotation=rot2, translation=tr2, bounds=[-20, 20, -20, 20, -20, 20])
    w.close()
    k1 = sstate == 0
    local1 = np.stack([rng_ * np.cos(el) * np.cos(az), rng_ * np.cos(el) * np.sin(az), rng_ * np.sin(el)], axis=1)[k1]
    p1 = to_global(local1, rot1, tr1)
    p2 = to_global(xyz2.astype(np.float64), rot2, tr2)
    expected['spherical_two_scans.e57'] = {
        'scans': [expectation(p1, norm16(fint[k1].astype(np.float64), 0, 1), 499), expectation(p2, None, 499)],
    }

    # 3 — colour in all three channels (AP 13.4): 16-bit integers stated as
    # such by colorLimits, each an 8-bit value times 257, so 8 bits come back
    # unchanged; coordinates on a millimetre grid.
    n3 = 4000
    raw3 = np.stack([rng.integers(0, 40000, n3), rng.integers(0, 6000, n3), rng.integers(0, 4000, n3)], axis=1)
    rgb8 = rng.integers(0, 256, (n3, 3))
    tr3 = (4470660.0, 5332190.0, 528.0)
    w = Writer(os.path.join(OUT, 'color_rgb.e57'), 'EPSG:5678')
    w.scan('color', [
        ('cartesianX', scaled(0, 40000, 0.001)),
        ('cartesianY', scaled(0, 6000, 0.001)),
        ('cartesianZ', scaled(0, 4000, 0.001)),
        ('colorRed', integer(0, 65535)),
        ('colorGreen', integer(0, 65535)),
        ('colorBlue', integer(0, 65535)),
    ], {
        'cartesianX': raw3[:, 0] * 0.001, 'cartesianY': raw3[:, 1] * 0.001, 'cartesianZ': raw3[:, 2] * 0.001,
        'colorRed': (rgb8[:, 0] * 257).astype(np.uint16), 'colorGreen': (rgb8[:, 1] * 257).astype(np.uint16),
        'colorBlue': (rgb8[:, 2] * 257).astype(np.uint16),
    }, translation=tr3, color_limits=(0, 65535))
    w.close()
    pts3 = to_global(raw3 * 0.001, (1, 0, 0, 0), tr3)
    expected['color_rgb.e57'] = {
        **expectation(pts3, None, 397),
        'rgbSum': [int(rgb8[:, c].sum()) for c in range(3)],
        'rgbSample': [[int(i), *map(int, rgb8[i])] for i in range(0, n3, 397)],
    }

    with open(os.path.join(OUT, 'expected.json'), 'w') as fh:
        json.dump(expected, fh, indent=None, separators=(',', ':'))


def from_laz(laz, out):
    """A LAZ file as E57 the way a scanner writes one: points local to the pose, in tenths of a millimetre."""
    import laspy
    las = laspy.read(laz)
    x, y, z = np.asarray(las.x), np.asarray(las.y), np.asarray(las.z)
    origin = (float(np.floor(x.min())), float(np.floor(y.min())), float(np.floor(z.min())))
    lx, ly, lz = x - origin[0], y - origin[1], z - origin[2]
    scale = 0.001
    # The integer grid stays the LAZ file's: its offset, seen from the pose.
    off = [float(las.header.offsets[k] - origin[k]) for k in range(3)]
    w = Writer(out)
    lo = [int(np.floor((v.min() - o) / scale)) - 1 for v, o in zip((lx, ly, lz), off)]
    hi = [int(np.ceil((v.max() - o) / scale)) + 1 for v, o in zip((lx, ly, lz), off)]
    w.scan('laz', [
        ('cartesianX', scaled(lo[0], hi[0], scale, off[0])), ('cartesianY', scaled(lo[1], hi[1], scale, off[1])),
        ('cartesianZ', scaled(lo[2], hi[2], scale, off[2])),
        ('intensity', integer(0, 65535)),
    ], {'cartesianX': lx, 'cartesianY': ly, 'cartesianZ': lz, 'intensity': np.asarray(las.intensity).astype(np.uint16)},
        translation=origin, bounds=[lx.min(), lx.max(), ly.min(), ly.max(), lz.min(), lz.max()], intensity_limits=(0, 65535))
    w.close()


if __name__ == '__main__':
    if len(sys.argv) == 3:
        from_laz(sys.argv[1], sys.argv[2])
    else:
        fixtures()
