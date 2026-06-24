"""티카투카 최선수 어드바이저 (대화형 CLI).

게임이 진행되는 동안 내 판/상대 판을 입력해두고, 내가 굴린 눈을 알려주면
몬테카를로 시뮬레이션으로 각 수의 승률을 계산해 최선의 수를 추천한다.

필드 입력 형식: 세 필드를 '|' 로 구분, 각 필드의 주사위는 공백 구분.
  예) me 5 5 | 3 |        -> 1번필드 [5,5], 2번필드 [3], 3번필드 []
  실드 주사위는 값 뒤에 s.  예) 6s
"""
from __future__ import annotations

import argparse

from engine import (
    DIE_MAX,
    DIE_MIN,
    ME,
    OPP,
    Die,
    GameState,
    PlayerBoard,
    apply_action,
    apply_shield_placement,
    board_field_scores,
    board_total,
    legal_actions,
    legal_shield_spots,
    winner,
)
from solver import evaluate_moves, evaluate_reroll

HELP = """\
라이브 진행 (판은 자동으로 추적됨):
  roll <눈>                   내가 굴린 눈으로 최선수 추천 (1~6)
  play [순위]                 직전 추천 수를 내 판에 반영 (기본 1순위)
  enemy <눈> <필드>           상대가 그 눈을 그 필드(1~3)에 둔 것을 기록
                             (알까기 조건이면 자동 발동)
판 직접 수정 / 기타:
  me  <f1> | <f2> | <f3>     내 판 통째로 설정   (예: me 5 5 | 3 | 2)
  opp <f1> | <f2> | <f3>     상대 판 통째로 설정 (예: opp 4 | 6 6 | )
  reroll on|off              내 리롤권 보유 여부 토글 (기본 on)
  show                       현재 판 출력
  sims <N>                   시뮬레이션 횟수 설정 (기본 2000)
  reset                      판 초기화
  help / quit
주사위는 공백 구분, 실드는 값 뒤 s (예: 6s). 빈 필드는 비워두면 됨.
"""


def parse_field(text: str) -> list[Die]:
    dice: list[Die] = []
    for tok in text.split():
        tok = tok.strip().lower()
        if not tok:
            continue
        shield = tok.endswith("s")
        num = tok[:-1] if shield else tok
        v = int(num)
        if not (DIE_MIN <= v <= DIE_MAX):
            raise ValueError(f"주사위 눈은 {DIE_MIN}~{DIE_MAX}: {v}")
        dice.append(Die(v, shield))
    if len(dice) > 3:
        raise ValueError("한 필드에 최대 3개")
    return dice


def parse_board(text: str, reroll: bool) -> PlayerBoard:
    parts = text.split("|")
    if len(parts) != 3:
        raise ValueError("필드 3개를 '|' 로 구분해 입력 (예: 5 5 | 3 | )")
    return PlayerBoard(fields=[parse_field(p) for p in parts], reroll_available=reroll)


def fmt_field(dice: list[Die]) -> str:
    inside = " ".join(repr(d) for d in dice) if dice else "-"
    return f"[{inside}]"


def show(state: GameState) -> None:
    me, opp = state.boards[ME], state.boards[OPP]
    ms, os = board_field_scores(me), board_field_scores(opp)
    print("\n          1번필드          2번필드          3번필드     총합")
    print(
        f"  상대  {fmt_field(opp.fields[0]):>14} {fmt_field(opp.fields[1]):>14} "
        f"{fmt_field(opp.fields[2]):>14}   {board_total(opp)}"
    )
    print(f"  점수  {os[0]:>14} {os[1]:>14} {os[2]:>14}")
    print(f"  점수  {ms[0]:>14} {ms[1]:>14} {ms[2]:>14}")
    print(
        f"   나   {fmt_field(me.fields[0]):>14} {fmt_field(me.fields[1]):>14} "
        f"{fmt_field(me.fields[2]):>14}   {board_total(me)}"
    )
    w = winner(state)
    label = {"me": "나", "opp": "상대", "draw": "무승부"}[w]
    print(f"  현재 판정(이대로 끝나면): {label}\n")


def cmd_roll(state: GameState, value: int, sims: int):
    state = state.clone()
    state.to_move = ME
    results = evaluate_moves(state, value, sims=sims)
    if not results:
        print("둘 수 있는 곳이 없습니다 (내 판이 가득 참).")
        return None
    print(f"\n  굴린 눈: {value}  (시뮬레이션 {sims}회)")
    for rank, m in enumerate(results, 1):
        mark = " <- 추천" if rank == 1 else ""
        print(f"   {rank}. {m.describe()}{mark}")
    advice = evaluate_reroll(state, value, sims=max(400, sims // 4))
    if advice:
        if advice.should_reroll:
            print(
                f"\n  리롤 권장: 유지 최선 {advice.keep_best * 100:.1f}% "
                f"< 리롤 기대 {advice.reroll_expected * 100:.1f}%"
            )
        else:
            print(
                f"\n  리롤 비권장: 유지 최선 {advice.keep_best * 100:.1f}% "
                f">= 리롤 기대 {advice.reroll_expected * 100:.1f}%"
            )
    print()
    return results


def apply_move(state: GameState, player: str, value: int, idx: int) -> GameState:
    """player 가 value 를 idx 필드에 두는 실제 수를 반영. 알까기 시 실드 배치 안내."""
    state = state.clone()
    state.to_move = player
    actions = {i: kind for kind, i in legal_actions(state, value)}
    if idx not in actions:
        raise ValueError(f"{idx + 1}번 필드에는 둘 수 없습니다 (가득 찼거나 범위 밖).")
    kind = actions[idx]
    s, pending = apply_action(state, value, (kind, idx))
    who = "나" if player == ME else "상대"
    if kind == "alkkagi":
        print(f"  {who}: {idx + 1}번 필드 알까기 발동 (상대 같은 눈 제거).")
        raw = input("  → 받은 실드 주사위 눈과 위치 "
                    "(예: '6 me 2' 내 2번 / '6 opp 1' 상대 1번): ").split()
        if raw:
            sval = int(raw[0])
            # owner 는 절대(me/opp). 미지정 시 둔 사람 본인 판. 알까기 실드는 양쪽 배치 가능.
            if len(raw) >= 2:
                owner = OPP if raw[1].lower().startswith("o") else ME
            else:
                owner = player
            i = int(raw[-1]) - 1 if len(raw) >= 2 else idx
            s = apply_shield_placement(s, sval, (owner, i))
    else:
        print(f"  {who}: {idx + 1}번 필드에 {value} 배치.")
    return s


def repl(sims: int) -> None:
    state = GameState.new()
    my_reroll = True
    last_value: int | None = None     # 직전 roll 의 눈
    last_results = None                # 직전 roll 의 추천 결과
    print("티카투카 어드바이저. 'help' 로 명령어 확인.")
    print("흐름: roll <눈> → play [순위] (내 수 반영) / enemy <눈> <필드> (상대 수 기록)\n")
    show(state)
    while True:
        try:
            line = input("> ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break
        if not line:
            continue
        cmd, _, rest = line.partition(" ")
        cmd = cmd.lower()
        try:
            if cmd in ("quit", "q", "exit"):
                break
            elif cmd == "help":
                print(HELP)
            elif cmd == "show":
                show(state)
            elif cmd == "reset":
                state = GameState.new()
                state.boards[ME].reroll_available = my_reroll
                show(state)
            elif cmd == "sims":
                sims = int(rest)
                print(f"  시뮬레이션 {sims}회로 설정.")
            elif cmd == "reroll":
                my_reroll = rest.strip().lower() in ("on", "true", "1", "yes")
                state.boards[ME].reroll_available = my_reroll
                print(f"  내 리롤권: {'있음' if my_reroll else '없음'}")
            elif cmd == "me":
                state.boards[ME] = parse_board(rest, my_reroll)
                show(state)
            elif cmd == "opp":
                state.boards[OPP] = parse_board(rest, True)
                show(state)
            elif cmd == "roll":
                v = int(rest)
                results = cmd_roll(state, v, sims)
                if results:
                    last_value, last_results = v, results
            elif cmd == "play":
                if not last_results:
                    print("  먼저 'roll <눈>' 으로 추천을 받으세요.")
                    continue
                rank = int(rest) if rest.strip() else 1
                if not (1 <= rank <= len(last_results)):
                    print(f"  순위는 1~{len(last_results)}.")
                    continue
                _, idx = last_results[rank - 1].action
                state = apply_move(state, ME, last_value, idx)
                last_results = None
                show(state)
            elif cmd == "enemy":
                v_str, _, f_str = rest.partition(" ")
                state = apply_move(state, OPP, int(v_str), int(f_str) - 1)
                show(state)
            else:
                print("알 수 없는 명령. 'help' 참고.")
        except Exception as e:  # noqa: BLE001 - 대화형 입력 오류는 보여주고 계속
            print(f"  오류: {e}")


def main() -> None:
    ap = argparse.ArgumentParser(description="티카투카 최선수 어드바이저")
    ap.add_argument("--sims", type=int, default=2000, help="시뮬레이션 횟수 (기본 2000)")
    args = ap.parse_args()
    repl(args.sims)


if __name__ == "__main__":
    main()
