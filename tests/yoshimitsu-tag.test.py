import importlib.util
from pathlib import Path
import unittest
import numpy as np

spec=importlib.util.spec_from_file_location('fit',Path(__file__).resolve().parents[1]/'scripts/fit-yoshimitsu-tag.py')
fit=importlib.util.module_from_spec(spec);spec.loader.exec_module(fit)


class TagFitTest(unittest.TestCase):
    def test_shoulder_tips_flatten_without_touching_the_head(self):
        p=np.array([[300.,520,0],[280,460,0],[320,460,0],[0,650,100]])
        n=np.array([[0.,1,0]])
        faces=[{'material':'yosi1u_13','corners':[(0,0,0),(1,0,0),(2,0,0)]}]
        edited,normal,report=fit.soften_shoulders(p,n,faces)
        self.assertLess(edited[0,1],478)
        np.testing.assert_array_equal(edited[1:],p[1:])
        self.assertTrue(np.isfinite(normal).all())
        self.assertEqual(report['vertices_lowered'],1)

    def test_duplicate_cleanup_preserves_reverse_shells_and_material_overlays(self):
        p=np.array([[0,0,0],[1,0,0],[0,1,0]])
        n=np.array([[0,0,1]])
        t=np.array([[0,0],[1,0],[0,1]])
        face={'corners':[(0,0,0),(1,1,0),(2,2,0)],'material':'a','group':0}
        reverse={**face,'corners':list(reversed(face['corners']))}
        overlay={**face,'material':'b'}
        kept,report=fit.clean_faces(p,n,t,[face,face,reverse,overlay])
        self.assertEqual(len(kept),3)
        self.assertEqual(report['exact_duplicate_faces_removed'],1)

    def test_weights_are_continuous_at_the_inner_cloth_seam(self):
        a=fit.weights(np.array([-.001,-450,50]))
        b=fit.weights(np.array([.001,-450,50]))
        self.assertLess(sum(abs(a.get(j,0)-b.get(j,0)) for j in set(a)|set(b)),.001)
        self.assertGreater(a[11],.5)
        for x in (-900,-500,-100,0,100,500,900):
            for y in (-1100,-1000,-620,-450,-100,0,400,600):
                w=fit.weights(np.array([x,y,0]))
                self.assertAlmostEqual(sum(w.values()),1)
                self.assertTrue(all(v>=0 for v in w.values()))

    def test_canonical_bases_are_proper_rotations(self):
        for origin,basis,scale in fit.canonical().values():
            np.testing.assert_allclose(basis.T@basis,np.eye(3))
            self.assertAlmostEqual(np.linalg.det(basis),1)
            self.assertTrue(np.all(scale>0))

    def test_hand_pose_transfer_keeps_the_existing_form_steps(self):
        frames=[{'r':np.eye(3).flatten().tolist(),'t':[0,0,0]} for _ in range(18)]
        v=lambda p:{'influences':[{'joint':6,'weight':1,'point':p}],'normalJoint':6,'normal':[0,0,4096],'uv':[0,0]}
        old={'vertices':[v([0,0,0])],'shapes':[{'part':12,'steps':[0,1,0],'vertices':[0],'shapes':[[{'points':[[0,0,0]],'normal':[0,0,4096]}],[{'points':[[0,5,0]],'normal':[0,0,4096]}]]}]}
        groups=fit.hand_shapes({'vertices':[v([10,0,0])]},old,frames)
        self.assertEqual(groups[0]['steps'],[0,1,0])
        self.assertEqual(groups[0]['shapes'][1][0]['points'],[[10,5,0]])


if __name__=='__main__':unittest.main()
