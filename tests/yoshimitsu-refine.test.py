import importlib.util
from pathlib import Path
import unittest

import numpy as np

spec = importlib.util.spec_from_file_location('refine', Path(__file__).resolve().parents[1] / 'scripts/enhance-yoshimitsu.py')
refine = importlib.util.module_from_spec(spec)
spec.loader.exec_module(refine)


class RefinementTest(unittest.TestCase):
    def test_refinement_is_bounded_keeps_borders_and_does_not_fold_faces(self):
        points = np.array([[x*0.01, y*0.01, 0.008*np.exp(-((x-4)**2+(y-4)**2)/5)]
                           for y in range(9) for x in range(9)])
        triangles = np.array([[y*9+x, y*9+x+1, (y+1)*9+x] for y in range(8) for x in range(8)] +
                             [[y*9+x+1, (y+1)*9+x+1, (y+1)*9+x] for y in range(8) for x in range(8)])
        normals = np.tile([0., 0., 1.], (81, 1))
        result, pinned = refine.refine(points, normals, triangles, np.full(81, 2.5))
        self.assertTrue(np.any(np.linalg.norm(result-points, axis=1) > 1e-6))
        self.assertLessEqual(np.linalg.norm(result-points, axis=1).max(), 0.004500001)
        np.testing.assert_array_equal(result[pinned], points[pinned])
        before = np.cross(points[triangles[:, 1]]-points[triangles[:, 0]], points[triangles[:, 2]]-points[triangles[:, 0]])
        after = np.cross(result[triangles[:, 1]]-result[triangles[:, 0]], result[triangles[:, 2]]-result[triangles[:, 0]])
        self.assertTrue(np.all(np.sum(before*after, axis=1) > 0))

    def test_unselected_geometry_is_identical(self):
        points = np.array([[0., 0., 0.], [1., 0., 0.], [0., 1., 0.]])
        result, _ = refine.refine(points, np.tile([0., 0., 1.], (3, 1)), np.array([[0, 1, 2]]), np.zeros(3))
        np.testing.assert_array_equal(result, points)


if __name__ == '__main__':
    unittest.main()
