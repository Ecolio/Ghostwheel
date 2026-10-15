import sys
import unittest
from pathlib import Path
from unittest.mock import patch
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "perception"))
from recognition import Identity, required_margin
from vision import Vision, profile_score, profile_similarity


def good_quality():
    # Les images de test sont noires : on neutralise le contrôle de qualité.
    return patch.object(Vision, "_quality", return_value=(None, True))


class RecognitionTests(unittest.TestCase):
    def test_one_poor_frame_does_not_restart_confirmation(self):
        identity = Identity()
        values = [0.46, 0.39, 0.45, 0.32, 0.44, 0.47]
        result = [identity.update([(score, "sacha")], i * 0.125, 0.42) for i, score in enumerate(values)]
        self.assertEqual(result, [None, None, None, None, None, "sacha"])
        for i in range(1, 10):
            self.assertEqual(identity.update([(0.37, "sacha")], .75 + i * .125, .42), "sacha")

    def test_three_frames_are_no_longer_enough(self):
        identity = Identity()
        for i in range(3):
            self.assertIsNone(identity.update([(.6, "sacha")], i * .125, .42))
        self.assertEqual(identity.update([(.6, "sacha")], .375, .42), "sacha")

    def test_poor_quality_frames_neither_confirm_nor_contradict(self):
        identity = Identity()
        for i in range(8):
            self.assertIsNone(identity.update([(.7, "frere"), (.3, "sacha")], i * .1, .42, usable=False))
        for i in range(4):
            identity.update([(.6, "sacha"), (.3, "frere")], 1 + i * .125, .42)
        self.assertEqual(identity.profile_id, "sacha")
        # Une image floue où le frère sort premier ne retire pas l’identité...
        self.assertEqual(identity.update([(.7, "frere"), (.3, "sacha")], 1.6, .42, usable=False), "sacha")
        self.assertEqual(identity.update([(.7, "frere")], 9.3, .42, usable=False), "sacha")
        # ...mais sans preuve nette pendant le maintien configuré (8 s par défaut), elle expire.
        self.assertIsNone(identity.update([(.7, "frere")], 9.4, .42, usable=False))

    def test_a_single_contradicting_vote_blocks_confirmation(self):
        identity = Identity()
        identity.update([(.6, "frere"), (.3, "sacha")], 0, .42)
        for i in range(1, 5):
            result = identity.update([(.6, "sacha"), (.3, "frere")], i * .125, .42)
        self.assertIsNone(result)
        self.assertEqual(identity.update([(.6, "sacha"), (.3, "frere")], 1.3, .42), "sacha")

    def test_lookalikes_require_a_clearer_margin(self):
        self.assertAlmostEqual(required_margin(0.1), 0.08)
        self.assertAlmostEqual(required_margin(0.5), 0.16)
        close = [(.55, "sacha"), (.45, "frere")]
        plain, lookalike = Identity(), Identity()
        for i in range(6):
            plain.update(close, i * .125, .42)
            lookalike.update(close, i * .125, .42, margin_for=lambda a, b: .14)
        self.assertEqual(plain.profile_id, "sacha")
        self.assertIsNone(lookalike.profile_id)

    def test_weak_or_ambiguous_evidence_holds_then_expires(self):
        identity = Identity()
        for i in range(4):
            identity.update([(.5, "sacha")], i * .125, .42)
        # Un score faible ou une image ambiguë n’est ni une preuve ni une contradiction.
        self.assertEqual(identity.update([(.28, "sacha")], .6, .42), "sacha")
        self.assertEqual(identity.update([(.45, "sacha"), (.43, "autre")], 4, .42), "sacha")
        self.assertEqual(identity.update([(.45, "sacha"), (.43, "autre")], 8.375, .42), "sacha")
        self.assertIsNone(identity.update([(.45, "sacha"), (.43, "autre")], 8.5, .42))
        # Le maintien se règle : 1,5 s retrouve l’ancien comportement.
        for i in range(4):
            identity.update([(.5, "sacha")], 10 + i * .125, .42, hold=1.5)
        self.assertEqual(identity.update([(.28, "sacha")], 11.8, .42, hold=1.5), "sacha")
        self.assertIsNone(identity.update([(.28, "sacha")], 11.9, .42, hold=1.5))

    def test_a_face_that_no_longer_matches_loses_its_identity_immediately(self):
        identity = Identity()
        for i in range(4):
            identity.update([(.5, "sacha")], i * .125, .42)
        self.assertIsNone(identity.update([(.15, "sacha")], .5, .42))

    def test_another_person_is_not_temporarily_assigned_the_old_identity(self):
        identity = Identity()
        for i in range(4):
            identity.update([(.6, "sacha"), (.2, "autre")], i * .125, .42)
        self.assertIsNone(identity.update([(.3, "sacha"), (.6, "autre")], .5, .42))
        for i in range(1, 3):
            self.assertIsNone(identity.update([(.3, "sacha"), (.6, "autre")], .5 + i * .125, .42))
        self.assertEqual(identity.update([(.3, "sacha"), (.6, "autre")], .875, .42), "autre")
        self.assertIsNone(identity.update([(.1, "sacha"), (.15, "autre")], 1.0, .42))

    def test_tolerant_setting_admits_lower_scores_only_after_confirmation(self):
        identity = Identity()
        for i in range(5):
            self.assertIsNone(identity.update([(.4, "sacha")], i * .125, .42))
        for i in range(4):
            result = identity.update([(.4, "sacha")], 1 + i * .125, .38)
        self.assertEqual(result, "sacha")

    def test_profile_score_uses_two_best_views_when_enough(self):
        feature = np.zeros(128, dtype=np.float32); feature[0] = 1
        few = np.zeros((3, 128), dtype=np.float32); few[:, 0] = [.9, .1, .1]
        many = np.zeros((6, 128), dtype=np.float32); many[:, 0] = [.9, .5, .1, .1, .1, .1]
        self.assertAlmostEqual(profile_score(few, feature), .9, places=5)
        self.assertAlmostEqual(profile_score(many, feature), .7, places=5)
        self.assertAlmostEqual(profile_similarity(few, few), (.81 + .09 + .09) / 3, places=5)

    def test_short_occlusion_preserves_tracking_without_inventing_presence(self):
        face = np.array([[100,100,180,180,140,150,240,150,190,190,150,230,230,230,.99]],dtype=np.float32)
        with good_quality(), patch("vision.cv2.FaceDetectorYN.create") as detector, patch("vision.cv2.FaceRecognizerSF.create") as recognizer, patch("vision.time.monotonic",side_effect=[0,.125,.25,.375,.5,1.5,3.2]):
            detector.return_value.detect.side_effect = [(1,face),(1,face),(1,face),(1,face),(0,None),(1,face),(1,face)]
            recognizer.return_value.feature.return_value = np.ones((1,128),dtype=np.float32)
            vision = Vision(Path("models"))
            vision.set_profiles([("sacha",np.ones((1,128),dtype=np.float32)/np.sqrt(128))])
            frame=np.zeros((480,640,3),dtype=np.uint8)
            vision.analyze(frame);vision.analyze(frame);vision.analyze(frame)
            confirmed=vision.analyze(frame)[0][0]
            self.assertEqual(confirmed["profileId"],"sacha")
            self.assertEqual(vision.analyze(frame)[0],[])
            returned=vision.analyze(frame)[0][0]
            self.assertEqual(returned,confirmed)
            expired=vision.analyze(frame)[0][0]
            self.assertNotEqual(expired["trackId"],confirmed["trackId"])
            self.assertIsNone(expired["profileId"])

    def test_configured_occlusion_keeps_tracking_but_rechecks_the_returning_face(self):
        face = np.array([[100,100,180,180,140,150,240,150,190,190,150,230,230,230,.99]], dtype=np.float32)
        known = np.zeros(128, dtype=np.float32); known[0] = 1
        # Le nouveau visage ressemble assez au suivi pour être comparé, mais pas au profil.
        other = np.zeros(128, dtype=np.float32); other[0] = .3; other[1] = np.sqrt(.91)
        with good_quality(), patch("vision.cv2.FaceDetectorYN.create") as detector, patch("vision.cv2.FaceRecognizerSF.create") as recognizer, patch("vision.time.monotonic", side_effect=[0,.125,.25,.375,5,14,14.1,14.2,20]):
            detector.return_value.detect.side_effect = [(1,face)] * 4 + [(0,None),(1,face),(0,None),(1,face),(1,face)]
            recognizer.return_value.feature.side_effect = [known.reshape(1,-1)] * 5 + [other.reshape(1,-1), known.reshape(1,-1)]
            vision = Vision(Path("models"))
            vision.configure_tracking(15000)
            vision.set_profiles([("sacha", known.reshape(1,-1)), ("autre", other.reshape(1,-1))])
            frame = np.zeros((480,640,3), dtype=np.uint8)
            for _ in range(3):
                vision.analyze(frame)
            confirmed = vision.analyze(frame)[0][0]
            self.assertEqual(confirmed["profileId"], "sacha")
            self.assertEqual(vision.analyze(frame)[0], [])
            self.assertEqual(vision.analyze(frame)[0][0], confirmed)
            self.assertEqual(vision.analyze(frame)[0], [])
            self.assertIsNone(vision.analyze(frame)[0][0]["profileId"])
            vision.configure_tracking(1500)
            expired = vision.analyze(frame)[0][0]
            self.assertNotEqual(expired["trackId"], confirmed["trackId"])
            self.assertIsNone(expired["profileId"])

    def test_tracking_duration_is_bounded(self):
        with patch("vision.cv2.FaceDetectorYN.create"), patch("vision.cv2.FaceRecognizerSF.create"):
            vision = Vision(Path("models"))
            for invalid in [-1, 60001, float("nan"), float("inf"), True, "15000"]:
                with self.assertRaises(ValueError):
                    vision.configure_tracking(invalid)
                with self.assertRaises(ValueError):
                    vision.configure_identity_hold(invalid)
            vision.configure_tracking(0)
            self.assertEqual(vision.tracking_grace, 0)
            self.assertEqual(vision.identity_hold, 8)
            vision.configure_identity_hold(2500)
            self.assertEqual(vision.identity_hold, 2.5)

    def test_a_turned_face_keeps_its_identity_for_the_configured_hold(self):
        face = np.array([[100,100,180,180,140,150,240,150,190,190,150,230,230,230,.99]],dtype=np.float32)
        times = [0, .125, .25, .375, 3, 5.375, 5.5]
        with patch.object(Vision, "_quality", side_effect=[(None, True)] * 4 + [(None, False)] * 3),                 patch("vision.cv2.FaceDetectorYN.create") as detector,                 patch("vision.cv2.FaceRecognizerSF.create") as recognizer,                 patch("vision.time.monotonic", side_effect=times):
            detector.return_value.detect.return_value = (1, face)
            recognizer.return_value.feature.return_value = np.ones((1,128),dtype=np.float32)
            vision = Vision(Path("models"))
            vision.configure_tracking(8000)
            vision.configure_identity_hold(5000)
            vision.set_profiles([("sacha",np.ones((1,128),dtype=np.float32)/np.sqrt(128))])
            frame = np.zeros((480,640,3),dtype=np.uint8)
            for _ in range(3):
                vision.analyze(frame)
            confirmed = vision.analyze(frame)[0][0]
            self.assertEqual(confirmed["profileId"], "sacha")
            # Visage tourné ou lointain : toujours suivi, sans preuve, l’identité tient 5 s.
            self.assertEqual(vision.analyze(frame)[0][0], confirmed)
            self.assertEqual(vision.analyze(frame)[0][0], confirmed)
            expired = vision.analyze(frame)[0][0]
            self.assertEqual(expired["trackId"], confirmed["trackId"])
            self.assertIsNone(expired["profileId"])

    def test_multiple_templates_compete_by_profile_not_by_view(self):
        face = np.array([[100,100,180,180,140,150,240,150,190,190,150,230,230,230,.99]],dtype=np.float32)
        front = np.zeros(128,dtype=np.float32); front[0] = 1
        side = np.zeros(128,dtype=np.float32); side[0] = .4; side[1] = np.sqrt(.84)
        with good_quality(), patch("vision.cv2.FaceDetectorYN.create") as detector, patch("vision.cv2.FaceRecognizerSF.create") as recognizer, patch("vision.time.monotonic",side_effect=[0,.2,.4,.6]):
            detector.return_value.detect.return_value = (1,face)
            recognizer.return_value.feature.return_value = side.reshape(1,-1)
            vision=Vision(Path("models"))
            vision.set_profiles([("sacha",np.stack([front,side,side])),("autre",(-front).reshape(1,-1))])
            frame=np.zeros((480,640,3),dtype=np.uint8)
            vision.analyze(frame);vision.analyze(frame);vision.analyze(frame)
            people, _, samples = vision.analyze(frame)
            self.assertEqual(people[0]["profileId"],"sacha")
            self.assertEqual(samples[0].identity,"sacha")
            self.assertEqual(samples[0].scores[0][1],"sacha")

    def test_dark_frames_are_not_used_to_identify(self):
        face = np.array([[100,100,180,180,140,150,240,150,190,190,150,230,230,230,.99]],dtype=np.float32)
        with patch("vision.cv2.FaceDetectorYN.create") as detector, patch("vision.cv2.FaceRecognizerSF.create") as recognizer:
            detector.return_value.detect.return_value = (1,face)
            recognizer.return_value.feature.return_value = np.ones((1,128),dtype=np.float32)
            vision=Vision(Path("models"))
            vision.set_profiles([("sacha",np.ones((1,128),dtype=np.float32)/np.sqrt(128))])
            frame=np.zeros((480,640,3),dtype=np.uint8)
            for _ in range(8):
                people, _, samples = vision.analyze(frame)
            self.assertIsNone(people[0]["profileId"])
            self.assertFalse(samples[0].usable)

    def test_engagement_tolerance_and_distance_are_independent_of_identity(self):
        with patch("vision.cv2.FaceDetectorYN.create"), patch("vision.cv2.FaceRecognizerSF.create"):
            vision = Vision(Path("models"))
            self.assertTrue(vision.is_engaged(100, 150, 150, .2))
            self.assertFalse(vision.is_engaged(100, 190, 150, .2))
            self.assertFalse(vision.is_engaged(100, 150, 150, .09))
            vision.configure_engagement({"poseTolerance": .45, "minFaceRatio": .08})
            self.assertTrue(vision.is_engaged(100, 190, 150, .09))
            self.assertFalse(vision.is_engaged(5, 150, 150, .2))
            self.assertEqual(vision.threshold, .42)
            with self.assertRaises(ValueError):
                vision.configure_engagement({"poseTolerance": .6, "minFaceRatio": .08})


if __name__ == "__main__":
    unittest.main()
