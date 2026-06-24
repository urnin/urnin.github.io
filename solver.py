"""몬테카를로 솔버: 현재 상태 + 내가 굴린 눈으로 각 수의 승률을 추정.

각 합법 수마다 N번의 무작위 플레이아웃을 돌려 (승 + 0.5*무) / N 으로 승률 추정.
양쪽 모두 그리디 정책으로 두므로 상대가 어느 정도 합리적으로 둔다고 가정한다.
"""
from __future__ import annotations

import random
from dataclasses import dataclass

from engine import (
    DIE_MAX,
    DIE_MIN,
    ME,
    OPP,
    Action,
    GameState,
    advance_turn,
    apply_action,
    apply_shield_placement,
    is_terminal,
    legal_actions,
    legal_shield_spots,
    winner,
)
from policy import GreedyPolicy

MAX_PLIES = 60  # 알까기로 인한 무한 루프 방지용 안전장치


def _roll(rng: random.Random) -> int:
    return rng.randint(DIE_MIN, DIE_MAX)


def _resolve_turn(state: GameState, value: int, action: Action, policy, rng) -> GameState:
    """한 수(알까기 시 실드 배치 포함)를 적용하고 턴을 넘긴 상태 반환."""
    s, pending = apply_action(state, value, action)
    if pending:
        spots = legal_shield_spots(s, allow_opponent=True)
        if spots:
            sval = _roll(rng)
            spot = policy.choose_shield(s, sval, spots)
            s = apply_shield_placement(s, sval, spot)
    return advance_turn(s)


def _playout(state: GameState, policy, rng: random.Random) -> str:
    """터미널까지 무작위로 진행하고 'me'/'opp'/'draw' 반환."""
    s = state
    for _ in range(MAX_PLIES):
        if is_terminal(s):
            break
        value = _roll(rng)
        actions = legal_actions(s, value)
        if not actions:
            # 둘 곳이 없으면 그냥 턴을 넘김 (사실상 터미널 직전 상태)
            s = advance_turn(s)
            continue
        action = policy.choose_action(s, value, actions)
        s = _resolve_turn(s, value, action, policy, rng)
    return winner(s)


@dataclass
class MoveEval:
    action: Action
    win: float
    draw: float
    loss: float
    sims: int

    @property
    def win_prob(self) -> float:
        return (self.win + 0.5 * self.draw) / self.sims if self.sims else 0.0

    def describe(self) -> str:
        kind, i = self.action
        label = f"{i + 1}번 필드 알까기" if kind == "alkkagi" else f"{i + 1}번 필드 배치"
        return (
            f"{label:<14} 승률 {self.win_prob * 100:5.1f}%  "
            f"(승 {self.win / self.sims * 100:.0f}% / 무 {self.draw / self.sims * 100:.0f}% / "
            f"패 {self.loss / self.sims * 100:.0f}%)"
        )


def evaluate_moves(
    state: GameState,
    value: int,
    sims: int = 2000,
    seed: int | None = None,
) -> list[MoveEval]:
    """state.to_move 가 ME 라고 가정. 각 수의 승률을 내림차순으로 반환."""
    assert state.to_move == ME, "evaluate_moves 는 내 턴(ME)에서 호출"
    rng = random.Random(seed)
    policy = GreedyPolicy(rng)
    results: list[MoveEval] = []
    for action in legal_actions(state, value):
        w = d = l = 0
        for _ in range(sims):
            after = _resolve_turn(state, value, action, policy, rng)
            outcome = _playout(after, policy, rng)
            if outcome == ME:
                w += 1
            elif outcome == OPP:
                l += 1
            else:
                d += 1
        results.append(MoveEval(action, w, d, l, sims))
    results.sort(key=lambda m: m.win_prob, reverse=True)
    return results


@dataclass
class RerollAdvice:
    keep_best: float       # 현재 눈으로 두는 최선의 승률
    reroll_expected: float # 리롤 시 기대 승률 (6개 눈 평균)
    should_reroll: bool


def evaluate_reroll(
    state: GameState,
    value: int,
    sims: int = 600,
    seed: int | None = None,
) -> RerollAdvice | None:
    """리롤이 가능하면 '리롤 vs 유지'를 비교. 불가하면 None."""
    if not state.boards[ME].reroll_available:
        return None
    keep = max(m.win_prob for m in evaluate_moves(state, value, sims=sims, seed=seed))

    # 리롤하면 리롤권 소모. 새 눈마다 최선 승률을 구해 평균.
    rerolled = state.clone()
    rerolled.boards[ME].reroll_available = False
    total = 0.0
    for v in range(DIE_MIN, DIE_MAX + 1):
        best = max(
            m.win_prob
            for m in evaluate_moves(rerolled, v, sims=sims, seed=seed)
        )
        total += best
    expected = total / (DIE_MAX - DIE_MIN + 1)
    return RerollAdvice(keep, expected, expected > keep)
