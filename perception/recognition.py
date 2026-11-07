"""Temporal identity confirmation; scores are cosine similarities, not probabilities."""
from collections import deque

# Écart minimal entre la première et la deuxième personne candidates. Deux profils qui se
# ressemblent (frères et sœurs) reçoivent un écart plus grand, voir required_margin.
MARGIN = 0.08
# Une identité déjà confirmée tolère des images un peu moins nettes.
HOLD_DROP = 0.08
# Durée par défaut pendant laquelle une identité confirmée survit sans nouvelle preuve
# (tête tournée, visage lointain ou flou, image ambiguë). Réglable dans l’administration.
HOLD = 8.0
# Sous ce score, le visage suivi ne ressemble plus du tout au profil : contradiction franche.
CONTRADICTION = 0.20
# Confirmation : au moins VOTES images concordantes sur WINDOW secondes, sans vote
# confiant contradictoire, étalées sur au moins SPREAD secondes.
WINDOW = 1.2
VOTES = 4
SPREAD = 0.3
# Machine lente (sans carte graphique, 450 ms par image) : 1,2 s ne contient pas quatre
# analyses. La fenêtre s'allonge alors au rythme mesuré, assez pour VOTES images et une
# de marge. Un intervalle isolé est plafonné : une pause ne dilate pas la fenêtre.
INTERVAL_CAP = 1.0


def vote_window(interval):
    """Fenêtre de confirmation pour un intervalle moyen entre analyses (None : inconnu)."""
    return WINDOW if interval is None else max(WINDOW, (VOTES + 0.5) * interval)


def required_margin(similarity):
    """Écart exigé entre deux profils selon leur ressemblance mutuelle (0 à 1)."""
    return min(0.16, MARGIN + max(0.0, similarity - 0.30) * 0.4)


class Identity:
    def __init__(self):
        self.profile_id = None
        self.last_supported = 0
        self.votes = deque(maxlen=16)
        self.last_update = None
        self.interval = None

    def clear(self):
        self.profile_id = None
        self.votes.clear()

    def update(self, scores, now, threshold, usable=True, margin_for=None, hold=HOLD):
        """scores : [(similarité, profil)] ; usable=False pour une image peu fiable.

        margin_for(a, b) renvoie l’écart exigé entre deux profils (ressemblance) ;
        hold est la durée en secondes d’une identité confirmée sans nouvelle preuve.
        """
        # Rythme des images précédentes : un écart isolé ne retient pas un vieux vote.
        window = vote_window(self.interval)
        if self.last_update is not None:
            step = min(max(now - self.last_update, 0.0), INTERVAL_CAP)
            self.interval = step if self.interval is None else self.interval * 0.7 + step * 0.3
        self.last_update = now
        ranked = sorted(scores, reverse=True)
        score, candidate = ranked[0] if ranked else (-1, None)
        runner = ranked[1][1] if len(ranked) > 1 else None
        margin = score - ranked[1][0] if len(ranked) > 1 else 1
        required = margin_for(candidate, runner) if margin_for and runner is not None else MARGIN
        confident = candidate is not None and score >= threshold and margin >= required
        if self.profile_id is not None:
            if usable:
                current_score = next((value for value, key in ranked if key == self.profile_id), -1)
                if current_score < CONTRADICTION or (candidate != self.profile_id and confident):
                    # Une autre personne reconnue, ou un visage qui ne ressemble plus du tout
                    # au profil : l’ancienne identité disparaît immédiatement.
                    self.clear()
                elif (
                    candidate == self.profile_id
                    and score >= threshold - HOLD_DROP
                    and margin >= required
                ):
                    self.last_supported = now
            # Image floue, lointaine, de profil ou ambiguë : ni preuve ni contradiction.
            if self.profile_id is not None:
                if now - self.last_supported <= hold:
                    return self.profile_id
                self.clear()
        if not usable:
            return self.profile_id
        self.votes.append((now, candidate if confident else None))
        while self.votes and now - self.votes[0][0] > window:
            self.votes.popleft()
        decided = [key for _, key in self.votes if key is not None]
        matching = [stamp for stamp, key in self.votes if key == candidate]
        if (
            confident
            and len(matching) >= VOTES
            and len(matching) == len(decided)
            and now - matching[0] >= SPREAD
        ):
            self.profile_id = candidate
            self.last_supported = now
            self.votes.clear()
        return self.profile_id
