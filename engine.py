"""티카투카(Tikatuka) 게임 엔진.

규칙 요약 (rule.MD + 사용자 확정):
- 2인 게임. 각 플레이어는 3개의 필드, 각 필드는 최대 3개의 주사위.
- 필드 점수: 같은 눈 n개가 한 필드에 모이면 (2n-1)*눈 만큼 합산.
    1개 -> v, 2개 -> 3v, 3개 -> 5v  (특별룰 1, 2)
- 승리: 3필드 중 2필드 이상에서 더 높은 합을 가진 쪽 승.
    그렇지 않으면(1-1-무 등) 전체 눈 합이 높은 쪽 승. 같으면 무승부.
- 알까기: 내가 놓으려는 필드와 '같은 위치'의 상대 필드에 같은 눈(실드 제외)이
    있으면 그 필드를 고를 때 반드시 발동.
      * 내가 던진 주사위 + 상대의 같은 눈(실드 제외)을 모두 제거 (트레이드).
      * 발동 후 실드 주사위 1개를 받아 아무 필드(상대 포함)에나 1개 배치. 리롤 불가.
      * 내 필드에 공간이 있을 때만 발동.
- 실드 주사위: 알까기로 제거되지 않음.
- 게임당 1회 리롤 가능.

명시되지 않아 구현에서 가정한 부분(README 참고):
- 게임 종료: 어느 한쪽 판이 가득 차면(9개) 종료 후 최종 점수 비교.
- 알까기는 상대의 같은 눈이 '실드가 아닌' 것이 1개 이상 있을 때만 발동.
"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from typing import Optional

NUM_FIELDS = 3
FIELD_CAPACITY = 3
DIE_MIN, DIE_MAX = 1, 6

ME = "me"
OPP = "opp"


def opponent(player: str) -> str:
    return OPP if player == ME else ME


@dataclass(frozen=True)
class Die:
    value: int
    shield: bool = False

    def __repr__(self) -> str:
        return f"{self.value}{'s' if self.shield else ''}"


@dataclass
class PlayerBoard:
    fields: list[list[Die]]
    reroll_available: bool = True

    @staticmethod
    def empty() -> "PlayerBoard":
        return PlayerBoard(fields=[[] for _ in range(NUM_FIELDS)])

    def is_full(self) -> bool:
        return all(len(f) >= FIELD_CAPACITY for f in self.fields)

    def count(self) -> int:
        return sum(len(f) for f in self.fields)


@dataclass
class GameState:
    boards: dict[str, PlayerBoard]
    to_move: str = ME

    @staticmethod
    def new() -> "GameState":
        return GameState(boards={ME: PlayerBoard.empty(), OPP: PlayerBoard.empty()})

    def clone(self) -> "GameState":
        return GameState(
            boards={
                k: PlayerBoard([list(f) for f in b.fields], b.reroll_available)
                for k, b in self.boards.items()
            },
            to_move=self.to_move,
        )


# --- 점수 / 승리 판정 -------------------------------------------------------

def field_score(dice: list[Die]) -> int:
    counts = Counter(d.value for d in dice)
    return sum((2 * n - 1) * v for v, n in counts.items())


def board_field_scores(board: PlayerBoard) -> list[int]:
    return [field_score(f) for f in board.fields]


def board_total(board: PlayerBoard) -> int:
    return sum(field_score(f) for f in board.fields)


def winner(state: GameState) -> str:
    """'me', 'opp', 또는 'draw' 반환."""
    me = board_field_scores(state.boards[ME])
    op = board_field_scores(state.boards[OPP])
    me_wins = sum(1 for m, o in zip(me, op) if m > o)
    op_wins = sum(1 for m, o in zip(me, op) if o > m)
    if me_wins >= 2:
        return ME
    if op_wins >= 2:
        return OPP
    mt, ot = sum(me), sum(op)
    if mt > ot:
        return ME
    if ot > mt:
        return OPP
    return "draw"


def is_terminal(state: GameState) -> bool:
    # 양쪽 판이 모두 가득 차야 게임 종료.
    return all(b.is_full() for b in state.boards.values())


# --- 합법 수 ---------------------------------------------------------------

# Action 표현:
#   ("place", i)    -> 굴린 주사위를 i번 필드에 일반 배치
#   ("alkkagi", i)  -> i번 필드를 골라 알까기 발동 (트레이드 + 실드 획득)
Action = tuple[str, int]


def _field_has_space(field: list[Die]) -> bool:
    return len(field) < FIELD_CAPACITY


def _opp_has_knockable(opp_field: list[Die], value: int) -> bool:
    return any(d.value == value and not d.shield for d in opp_field)


def legal_actions(state: GameState, value: int) -> list[Action]:
    me = state.boards[state.to_move]
    opp = state.boards[opponent(state.to_move)]
    actions: list[Action] = []
    for i in range(NUM_FIELDS):
        if not _field_has_space(me.fields[i]):
            continue
        if _opp_has_knockable(opp.fields[i], value):
            actions.append(("alkkagi", i))
        else:
            actions.append(("place", i))
    return actions


def apply_action(state: GameState, value: int, action: Action) -> tuple[GameState, bool]:
    """action 적용. (새 상태, 실드주사위_배치_대기여부) 반환.

    실드 대기가 True면 호출측이 이어서 shield 주사위를 굴려 배치해야 함.
    턴 전환은 여기서 하지 않음 (실드 배치 후 호출측이 처리).
    """
    s = state.clone()
    me = s.boards[s.to_move]
    opp = s.boards[opponent(s.to_move)]
    kind, i = action
    if kind == "place":
        me.fields[i].append(Die(value))
        return s, False
    if kind == "alkkagi":
        # 내 주사위는 놓지 않고 버림 + 상대 같은 눈(실드 제외) 제거
        opp.fields[i] = [
            d for d in opp.fields[i] if not (d.value == value and not d.shield)
        ]
        return s, True
    raise ValueError(f"unknown action: {action}")


# --- 실드 주사위 배치 ------------------------------------------------------

ShieldSpot = tuple[str, int]  # (owner, field_index)


def legal_shield_spots(state: GameState, allow_opponent: bool = True) -> list[ShieldSpot]:
    """실드 주사위를 놓을 수 있는 칸.

    allow_opponent=True  : 알까기로 얻은 실드 주사위 (상대 필드에도 배치 가능).
    allow_opponent=False : 선턴 시작 실드 주사위 (내 필드에만 배치 가능).
    """
    owners = (state.to_move, opponent(state.to_move)) if allow_opponent else (state.to_move,)
    spots: list[ShieldSpot] = []
    for owner in owners:
        b = state.boards[owner]
        for i in range(NUM_FIELDS):
            if _field_has_space(b.fields[i]):
                spots.append((owner, i))
    return spots


def apply_shield_placement(
    state: GameState, value: int, spot: ShieldSpot
) -> GameState:
    s = state.clone()
    owner, i = spot
    s.boards[owner].fields[i].append(Die(value, shield=True))
    return s


def advance_turn(state: GameState) -> GameState:
    s = state.clone()
    s.to_move = opponent(s.to_move)
    return s
