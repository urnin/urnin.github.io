"""플레이아웃용 정책. 시뮬레이션에서 상대(및 미래의 나)를 어떻게 둘지 결정.

랜덤 정책은 빠르지만 약해서 승률을 과대평가하므로 기본은 그리디.
그리디는 '이 수를 둔 직후의 판세 휴리스틱'을 최대화하는 수를 고른다.
"""
from __future__ import annotations

import random

from engine import (
    Action,
    GameState,
    ShieldSpot,
    apply_action,
    apply_shield_placement,
    board_field_scores,
    legal_shield_spots,
)


def _perspective_value(state: GameState, player: str) -> float:
    """player 관점의 판세 점수. 필드 우세 수를 크게, 총합 차이를 작게 반영."""
    opp = "opp" if player == "me" else "me"
    me_s = board_field_scores(state.boards[player])
    op_s = board_field_scores(state.boards[opp])
    field_edge = sum(1 for m, o in zip(me_s, op_s) if m > o) - sum(
        1 for m, o in zip(me_s, op_s) if o > m
    )
    total_edge = sum(me_s) - sum(op_s)
    return field_edge * 10.0 + total_edge


class RandomPolicy:
    def __init__(self, rng: random.Random | None = None):
        self.rng = rng or random

    def choose_action(self, state: GameState, value: int, actions: list[Action]) -> Action:
        return self.rng.choice(actions)

    def choose_shield(
        self, state: GameState, value: int, spots: list[ShieldSpot]
    ) -> ShieldSpot:
        own = [s for s in spots if s[0] == state.to_move]
        return self.rng.choice(own or spots)


class GreedyPolicy:
    """한 수 앞 휴리스틱을 최대화. 동점이면 랜덤 타이브레이크로 다양성 확보."""

    def __init__(self, rng: random.Random | None = None):
        self.rng = rng or random

    def choose_action(self, state: GameState, value: int, actions: list[Action]) -> Action:
        player = state.to_move
        best_score = None
        best: list[Action] = []
        for action in actions:
            nxt, _pending = apply_action(state, value, action)
            score = _perspective_value(nxt, player)
            if best_score is None or score > best_score:
                best_score, best = score, [action]
            elif score == best_score:
                best.append(action)
        return self.rng.choice(best)

    def choose_shield(
        self, state: GameState, value: int, spots: list[ShieldSpot]
    ) -> ShieldSpot:
        player = state.to_move
        best_score = None
        best: list[ShieldSpot] = []
        for spot in spots:
            nxt = apply_shield_placement(state, value, spot)
            score = _perspective_value(nxt, player)
            if best_score is None or score > best_score:
                best_score, best = score, [spot]
            elif score == best_score:
                best.append(spot)
        return self.rng.choice(best)
