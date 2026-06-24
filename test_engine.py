"""엔진 단위 테스트. 실행: python -m pytest test_engine.py  또는  python test_engine.py"""
from engine import (
    ME,
    OPP,
    Die,
    GameState,
    PlayerBoard,
    apply_action,
    apply_shield_placement,
    field_score,
    legal_actions,
    legal_shield_spots,
    winner,
)


def b(*fields):
    """필드 헬퍼: b([5,5],[3],[]) 처럼 값 리스트로 PlayerBoard 생성."""
    return PlayerBoard(fields=[[Die(v) for v in f] for f in fields])


def test_field_score_basic():
    assert field_score([Die(5), Die(3), Die(2)]) == 10


def test_field_score_pair_bonus():
    # 5,5 -> 3*5 = 15
    assert field_score([Die(5), Die(5)]) == 15
    # 5,5,3 -> 15 + 3
    assert field_score([Die(5), Die(5), Die(3)]) == 18


def test_field_score_triple_bonus():
    # 4,4,4 -> 5*4 = 20
    assert field_score([Die(4), Die(4), Die(4)]) == 20


def test_winner_two_fields():
    me = b([6], [6], [1])
    opp = b([5], [5], [6])
    # 나: 1,2번 우세 -> 2필드 -> 나 승
    assert winner(GameState({ME: me, OPP: opp})) == ME


def test_winner_total_tiebreak():
    # 1-1-무 상황: 필드 우세 동률, 총합으로 판정
    me = b([6], [1], [3])   # 합 10
    opp = b([1], [6], [2])  # 합 9
    assert winner(GameState({ME: me, OPP: opp})) == ME


def test_winner_draw():
    me = b([5], [5], [5])
    opp = b([5], [5], [5])
    assert winner(GameState({ME: me, OPP: opp})) == "draw"


def test_legal_actions_alkkagi_same_field_only():
    me = GameState(
        {ME: b([], [], []), OPP: b([3], [5], [])}, to_move=ME
    )
    # 눈 3: 상대 1번필드에 3 있음 -> 1번은 alkkagi, 나머지는 place
    actions = {i: kind for kind, i in legal_actions(me, 3)}
    assert actions[0] == "alkkagi"
    assert actions[1] == "place"
    assert actions[2] == "place"


def test_alkkagi_trade_removes_both():
    state = GameState({ME: b([], [], []), OPP: b([3, 3], [], [])}, to_move=ME)
    s, pending = apply_action(state, 3, ("alkkagi", 0))
    assert pending is True
    # 상대 1번필드의 3들이 제거됨
    assert s.boards[OPP].fields[0] == []
    # 내 주사위는 놓이지 않음 (트레이드)
    assert s.boards[ME].fields[0] == []


def test_alkkagi_does_not_remove_shield():
    opp = PlayerBoard(fields=[[Die(3, shield=True), Die(3)], [], []])
    state = GameState({ME: b([], [], []), OPP: opp}, to_move=ME)
    s, _ = apply_action(state, 3, ("alkkagi", 0))
    # 실드 3은 남고 일반 3만 제거
    assert s.boards[OPP].fields[0] == [Die(3, shield=True)]


def test_shield_immune_no_alkkagi_offered():
    # 상대 1번필드에 실드 3만 있으면 알까기 대상 없음 -> place
    opp = PlayerBoard(fields=[[Die(3, shield=True)], [], []])
    state = GameState({ME: b([], [], []), OPP: opp}, to_move=ME)
    assert {i: kind for kind, i in legal_actions(state, 3)}[0] == "place"


def test_start_shield_cannot_go_to_opponent():
    state = GameState({ME: b([], [], []), OPP: b([], [], [])}, to_move=ME)
    own_only = legal_shield_spots(state, allow_opponent=False)
    assert all(owner == ME for owner, _ in own_only)
    both = legal_shield_spots(state, allow_opponent=True)
    assert any(owner == OPP for owner, _ in both)


def _run_all():
    fns = [v for k, v in globals().items() if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"  PASS {fn.__name__}")
    print(f"\n{len(fns)}개 테스트 통과")


if __name__ == "__main__":
    _run_all()
