/* 티카투카 엔진 + 몬테카를로 솔버 (브라우저/Node 공용 순수 로직).
 *
 * 규칙:
 *  - 2인. 플레이어당 3필드 x 3칸.
 *  - 필드 점수: 같은 눈 n개 -> (2n-1)*눈.  (1=v, 2=3v, 3=5v)
 *  - 승리: 3필드 중 2필드 우세 -> 승. 아니면 총합 비교, 같으면 무승부.
 *  - 알까기: 내가 놓는 필드와 같은 위치의 상대 필드에 같은 눈(실드 제외)이 있으면
 *           그 필드 선택 시 발동. 내 주사위+상대 그 눈 제거(트레이드), 실드 1개 획득.
 *           실드는 양쪽 어디든 배치 가능, 리롤 불가.
 *  - 실드 주사위는 알까기로 제거되지 않음.
 *  - 리롤: 게임당 1회. 리롤해도 이전 눈을 버리지 않고 두 눈 중 하나 선택.
 *
 * 가정: 어느 한쪽 판이 가득 차면(9개) 종료 후 최종 점수 비교.
 *       시뮬레이션 속 상대는 '한 수 앞 판세'를 최대화하는 그리디.
 */
(function (root) {
  "use strict";

  var CAP = 3;
  var NF = 3;
  var MAX_PLIES = 120; // 양쪽 다 찰 때까지 + 알까기 churn 대비 안전장치

  function other(p) { return p === "me" ? "opp" : "me"; }

  function fieldScore(dice) {
    var c = {};
    for (var k = 0; k < dice.length; k++) c[dice[k].value] = (c[dice[k].value] || 0) + 1;
    var t = 0;
    for (var v in c) t += (2 * c[v] - 1) * Number(v);
    return t;
  }

  function boardScores(b) { return b.fields.map(fieldScore); }
  function boardTotal(b) { return boardScores(b).reduce(function (a, x) { return a + x; }, 0); }

  function winner(st) {
    var m = boardScores(st.me), o = boardScores(st.opp);
    var mw = 0, ow = 0;
    for (var i = 0; i < NF; i++) { if (m[i] > o[i]) mw++; else if (o[i] > m[i]) ow++; }
    if (mw >= 2) return "me";
    if (ow >= 2) return "opp";
    var mt = m.reduce(function (a, x) { return a + x; }, 0);
    var ot = o.reduce(function (a, x) { return a + x; }, 0);
    if (mt > ot) return "me";
    if (ot > mt) return "opp";
    return "draw";
  }

  function boardFull(b) { return b.fields.every(function (f) { return f.length >= CAP; }); }
  // 한 플레이어가 더 둘 수 없는(끝난) 상태: 홀드했거나 판이 가득 참.
  function isDone(b) { return !!b.held || boardFull(b); }

  // 양쪽이 모두 끝나야(홀드 또는 가득) 게임 종료.
  function isTerminal(st) {
    return isDone(st.me) && isDone(st.opp);
  }

  function newState() {
    return {
      me: { fields: [[], [], []], reroll: true, held: false },
      opp: { fields: [[], [], []], reroll: true, held: false }
    };
  }

  function clone(st) {
    function cb(b) {
      return { fields: b.fields.map(function (f) {
        return f.map(function (d) {
          var nd = { value: d.value, shield: !!d.shield };
          if (d.by) nd.by = d.by;
          return nd;
        });
      }), reroll: b.reroll, held: !!b.held };
    }
    return { me: cb(st.me), opp: cb(st.opp) };
  }

  // action: {kind:'place'|'alkkagi', i}
  function legalActions(st, value, player) {
    var me = st[player], opp = st[other(player)], acts = [];
    for (var i = 0; i < NF; i++) {
      if (me.fields[i].length >= CAP) continue;
      var knock = opp.fields[i].some(function (d) { return d.value === value && !d.shield; });
      acts.push({ kind: knock ? "alkkagi" : "place", i: i });
    }
    return acts;
  }

  // st 를 직접 변경. 알까기면 true 반환(실드 배치 필요).
  function applyAction(st, value, action, player) {
    var me = st[player], opp = st[other(player)];
    if (action.kind === "place") {
      me.fields[action.i].push({ value: value, shield: false });
      return false;
    }
    opp.fields[action.i] = opp.fields[action.i].filter(function (d) {
      return !(d.value === value && !d.shield);
    });
    return true;
  }

  function shieldSpots(st, player, allowOpp) {
    var owners = allowOpp ? [player, other(player)] : [player];
    var spots = [];
    owners.forEach(function (o) {
      for (var i = 0; i < NF; i++) if (st[o].fields[i].length < CAP) spots.push({ owner: o, i: i });
    });
    return spots;
  }

  function applyShield(st, value, spot, by) {
    var die = { value: value, shield: true };
    if (by) die.by = by; // 누가 놓은 실드인지 ('me' | 'opp'). 점수엔 영향 없음.
    st[spot.owner].fields[spot.i].push(die);
  }

  // --- 그리디 정책 (시뮬레이션용) ---
  function perspective(st, player) {
    var me = boardScores(st[player]), op = boardScores(st[other(player)]);
    var edge = 0;
    for (var i = 0; i < NF; i++) { if (me[i] > op[i]) edge++; else if (op[i] > me[i]) edge--; }
    var mt = me.reduce(function (a, x) { return a + x; }, 0);
    var ot = op.reduce(function (a, x) { return a + x; }, 0);
    return edge * 10 + (mt - ot);
  }

  function greedyAction(st, value, acts, player) {
    var best = -1e9, pick = [];
    for (var k = 0; k < acts.length; k++) {
      var c = clone(st); applyAction(c, value, acts[k], player);
      var s = perspective(c, player);
      if (s > best) { best = s; pick = [acts[k]]; } else if (s === best) pick.push(acts[k]);
    }
    return pick[(Math.random() * pick.length) | 0];
  }

  function greedyShield(st, value, spots, player) {
    var best = -1e9, pick = [];
    for (var k = 0; k < spots.length; k++) {
      var c = clone(st); applyShield(c, value, spots[k]);
      var s = perspective(c, player);
      if (s > best) { best = s; pick = [spots[k]]; } else if (s === best) pick.push(spots[k]);
    }
    return pick[(Math.random() * pick.length) | 0];
  }

  function rollDie() { return 1 + ((Math.random() * 6) | 0); }

  function resolveTurn(st, value, action, player) {
    var pending = applyAction(st, value, action, player);
    if (pending) {
      var spots = shieldSpots(st, player, true);
      if (spots.length) {
        var sv = rollDie();
        applyShield(st, sv, greedyShield(st, sv, spots, player));
      }
    }
  }

  function playout(st, toMove) {
    var p = toMove;
    for (var t = 0; t < MAX_PLIES; t++) {
      if (isTerminal(st)) break;
      // 끝난(홀드/가득) 플레이어는 건너뜀.
      if (isDone(st[p])) { p = other(p); continue; }
      var v = rollDie();
      var acts = legalActions(st, v, p);
      if (!acts.length) { p = other(p); continue; }
      resolveTurn(st, v, greedyAction(st, v, acts, p), p);
      p = other(p);
    }
    return winner(st);
  }

  // player가 value를 둘 때 각 수의 결과를 평가. winProb 는 항상 '내(me) 승률'.
  // player='me' 면 내림차순(내게 좋은 순), player='opp' 면 오름차순(상대에게 좋은 순).
  function evaluateMovesFor(st, value, player, sims) {
    sims = sims || 1500;
    var acts = legalActions(st, value, player);
    var out = [];
    for (var a = 0; a < acts.length; a++) {
      var w = 0, d = 0, l = 0;
      for (var s = 0; s < sims; s++) {
        var c = clone(st);
        resolveTurn(c, value, acts[a], player);
        var r = playout(c, other(player));
        if (r === "me") w++; else if (r === "opp") l++; else d++;
      }
      out.push({ action: acts[a], w: w, d: d, l: l, sims: sims, winProb: (w + 0.5 * d) / sims });
    }
    out.sort(function (x, y) {
      return player === "opp" ? x.winProb - y.winProb : y.winProb - x.winProb;
    });
    return out;
  }

  // 내 턴(me) 기준. 각 수의 내 승률을 내림차순 반환.
  function evaluateMoves(st, value, sims) {
    return evaluateMovesFor(st, value, "me", sims);
  }

  // 알까기 후 내가 받은 실드 주사위(value)를 어디 둘지 — 위치별 승률(me 기준).
  // 실드 배치 후 턴은 상대로 넘어간다.
  // player가 받은 실드(value)를 어디 둘지 — 위치별 승률(항상 me 기준).
  // 실드 배치 후 턴은 상대로 넘어감. player에게 유리한 순으로 정렬.
  function evaluateShieldFor(st, value, player, sims, allowOpp) {
    sims = sims || 1500;
    if (allowOpp === undefined) allowOpp = true;
    var spots = shieldSpots(st, player, allowOpp);
    var out = [];
    for (var k = 0; k < spots.length; k++) {
      var w = 0, d = 0, l = 0;
      for (var s = 0; s < sims; s++) {
        var c = clone(st);
        applyShield(c, value, spots[k]);
        var r = playout(c, other(player));
        if (r === "me") w++; else if (r === "opp") l++; else d++;
      }
      out.push({ spot: spots[k], w: w, d: d, l: l, sims: sims, winProb: (w + 0.5 * d) / sims });
    }
    out.sort(function (x, y) {
      return player === "opp" ? x.winProb - y.winProb : y.winProb - x.winProb;
    });
    return out;
  }

  function evaluateShield(st, value, sims, allowOpp) {
    return evaluateShieldFor(st, value, "me", sims, allowOpp);
  }

  // 현재 판(toMove가 둘 차례) 기준, 주사위 굴리기 전 내 승률.
  function evaluatePosition(st, toMove, sims) {
    sims = sims || 800;
    var w = 0, d = 0, l = 0;
    for (var s = 0; s < sims; s++) {
      var c = clone(st);
      var r = playout(c, toMove);
      if (r === "me") w++; else if (r === "opp") l++; else d++;
    }
    return (w + 0.5 * d) / sims;
  }

  // who가 지금 홀드하면(더 안 둠) 상대만 진행했을 때의 내 승률.
  function evaluateHold(st, who, sims) {
    sims = sims || 800;
    var w = 0, d = 0, l = 0;
    for (var s = 0; s < sims; s++) {
      var c = clone(st);
      c[who].held = true;
      var r = playout(c, other(who));
      if (r === "me") w++; else if (r === "opp") l++; else d++;
    }
    return (w + 0.5 * d) / sims;
  }

  var API = {
    CAP: CAP, NF: NF, other: other,
    fieldScore: fieldScore, boardScores: boardScores, boardTotal: boardTotal,
    winner: winner, isTerminal: isTerminal, isDone: isDone, boardFull: boardFull,
    newState: newState, clone: clone,
    legalActions: legalActions, applyAction: applyAction,
    shieldSpots: shieldSpots, applyShield: applyShield,
    rollDie: rollDie, perspective: perspective,
    greedyAction: greedyAction, greedyShield: greedyShield,
    evaluateMoves: evaluateMoves, evaluateMovesFor: evaluateMovesFor,
    evaluateShield: evaluateShield, evaluateShieldFor: evaluateShieldFor,
    evaluatePosition: evaluatePosition, evaluateHold: evaluateHold
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  root.TIKA = API;
})(typeof window !== "undefined" ? window : this);
