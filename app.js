/* 티카투카 어드바이저 UI. engine.js(TIKA) 위에서 동작. */
(function () {
  "use strict";
  var T = window.TIKA;

  var state = T.newState();
  var ui = {
    turn: "me",      // 'me' | 'opp'
    dice: [],        // 선택한 눈 (리롤 시 2개)
    fieldBest: {},   // 내 차례: 필드 index -> {die, winProb, action}
    rec: null,       // 추천 필드 index
    oppFieldBest: {},// 상대 차례: 필드 index -> {winProb(=내 승률), action}
    oppRec: null,    // 상대 최선(=내 승률 최소) 필드 index
    shield: null,    // {player, allowOpp, stage:'value'|'place', value}
    shieldEval: null // 실드 배치 추천: {map:{'owner:i':winProb}, rec:{owner,i}}
  };

  var $ = function (id) { return document.getElementById(id); };

  // ---------- 렌더링 ----------
  function dieEl(d) {
    var e = document.createElement("div");
    e.className = "die" + (d.shield ? " shield" : "");
    if (d.shield && d.by) e.classList.add(d.by === "me" ? "shield-me" : "shield-opp");
    e.textContent = d.value;
    return e;
  }

  function renderBoard(boardId, owner) {
    var host = $(boardId);
    host.innerHTML = "";
    var ms = T.boardScores(state.me), os = T.boardScores(state.opp);
    var myS = owner === "me" ? ms : os;
    var oppS = owner === "me" ? os : ms;
    for (var i = 0; i < 3; i++) {
      var f = state[owner].fields[i];
      var div = document.createElement("div");
      div.className = "field";
      div.dataset.owner = owner;
      div.dataset.index = i;

      // 승/패 색
      if (myS[i] > oppS[i]) div.classList.add("win");
      else if (myS[i] < oppS[i]) div.classList.add("lose");

      var slots = document.createElement("div");
      slots.className = "slots";
      var mkEmpty = function () { var sl = document.createElement("div"); sl.className = "slot-empty"; return sl; };
      if (owner === "me") {
        // 중앙(오른쪽)부터: 빈칸 먼저, 주사위는 역순(첫 주사위가 가장 안쪽)
        for (var e = f.length; e < 3; e++) slots.appendChild(mkEmpty());
        for (var k = f.length - 1; k >= 0; k--) slots.appendChild(dieEl(f[k]));
      } else {
        // 중앙(왼쪽)부터: 주사위 먼저(첫 주사위가 가장 안쪽), 빈칸 나중
        for (var k2 = 0; k2 < f.length; k2++) slots.appendChild(dieEl(f[k2]));
        for (var e2 = f.length; e2 < 3; e2++) slots.appendChild(mkEmpty());
      }

      var sc = document.createElement("div");
      sc.className = "fscore";
      sc.innerHTML = (i + 1) + "번 · <b>" + myS[i] + "</b>";

      // 클릭 가능 강조
      var clickable = false;
      if (ui.shield && ui.shield.stage === "place") {
        clickable = f.length < 3 && (owner === ui.shield.player || ui.shield.allowOpp);
      } else if (ui.dice.length) {
        if (ui.turn === "me" && owner === "me" && ui.fieldBest[i]) clickable = true;
        if (ui.turn === "opp" && owner === "opp" && f.length < 3) clickable = true;
      }
      if (clickable) div.classList.add("clickable");

      // 내 차례 승률 핀
      if (ui.turn === "me" && owner === "me" && !ui.shield && ui.fieldBest[i]) {
        var b = ui.fieldBest[i];
        var pill = document.createElement("div");
        pill.className = "winpill" + (b.action.kind === "alkkagi" ? " alk" : "") +
          (i === ui.rec ? " best" : "");
        var dieTag = ui.dice.length > 1 ? ("[" + b.die + "] ") : "";
        pill.textContent = dieTag + (b.action.kind === "alkkagi" ? "알까기 " : "") +
          (b.winProb * 100).toFixed(0) + "%";
        div.appendChild(pill);
        if (i === ui.rec) div.classList.add("recommend");
      }

      // 상대 차례: 상대가 이 필드에 두면 '내 승률' 핀 (상대 최선 = 빨강 표시)
      if (ui.turn === "opp" && owner === "opp" && !ui.shield && ui.oppFieldBest[i]) {
        var ob = ui.oppFieldBest[i];
        var opill = document.createElement("div");
        opill.className = "winpill" + (ob.action.kind === "alkkagi" ? " alk" : "") +
          (i === ui.oppRec ? " oppbest" : "");
        opill.textContent = (ob.action.kind === "alkkagi" ? "알까기 " : "") +
          "내 " + (ob.winProb * 100).toFixed(0) + "%";
        div.appendChild(opill);
      }

      // 실드 배치 단계 승률 핀 (내 알까기 실드)
      if (ui.shield && ui.shield.stage === "place" && ui.shieldEval) {
        var key = owner + ":" + i;
        if (key in ui.shieldEval.map) {
          var sp = document.createElement("div");
          var isRec = ui.shieldEval.rec.owner === owner && ui.shieldEval.rec.i === i;
          sp.className = "winpill" + (isRec ? " best" : "");
          sp.textContent = "실드 " + (ui.shieldEval.map[key] * 100).toFixed(0) + "%";
          div.appendChild(sp);
          if (isRec) div.classList.add("recommend");
        }
      }

      div.appendChild(slots);
      div.appendChild(sc);
      host.appendChild(div);
    }
  }

  function renderVerdict() {
    var w = T.winner(state);
    var name = { me: "나", opp: "상대", draw: "무승부" }[w];
    var color = w === "me" ? "var(--me)" : w === "opp" ? "var(--opp)" : "var(--muted)";
    var mt = T.boardTotal(state.me), ot = T.boardTotal(state.opp);
    $("verdict").innerHTML = "이대로 끝나면 → <b style='color:" + color + "'>" + name +
      "</b> <span class='hint'>(총합 나 " + mt + " : 상대 " + ot + ")</span>";
  }

  function renderWinrate() {
    var lbl = $("wrLabel"), fill = $("wrFill");
    if (!lbl) return;
    if (ui.startPicking || (ui.shield && ui.shield.stage === "value")) return; // 선택 모달 중엔 보류
    var sig = JSON.stringify(state) + "|" + ui.turn;
    if (sig === ui._wrSig) return; // 판이 안 바뀌었으면 재계산 생략
    ui._wrSig = sig;
    var liveSims = Math.min(800, sims());
    var p = T.evaluatePosition(state, ui.turn, liveSims);
    ui._wr = p;
    fill.style.width = (p * 100).toFixed(1) + "%";
    var over = T.isTerminal(state);
    var note = over ? "게임 종료" : (ui.turn === "me" ? "내" : "상대") + " 차례 · 주사위 굴리기 전";
    lbl.innerHTML = "실시간 내 승률 <b>" + (p * 100).toFixed(0) + "%</b> " +
      "<span class='hint'>(" + note + ")</span>";
  }

  // 홀드 버튼: 굴린 뒤, '홀드하면 승리 확정(100%)'일 때만 표시.
  function renderHold() {
    var hb = $("holdBtn");
    if (!hb) return;
    if (T.isTerminal(state) || ui.shield || ui.startPicking || !ui.dice.length) {
      hb.style.display = "none"; hb.classList.remove("hold-good"); return;
    }
    var who = ui.turn;
    var sigH = JSON.stringify(state) + "|hold|" + who;
    if (sigH !== ui._holdSig) {
      ui._holdSig = sigH;
      ui._holdWR = T.evaluateHold(state, who, Math.min(600, sims()));
    }
    var wr = ui._holdWR;
    // who 입장의 승리 확정 여부 (me면 내 승률 100%, opp면 상대 승률 100% = 내 승률 0%)
    var sure = who === "me" ? wr >= 0.999 : wr <= 0.001;
    if (!sure) { hb.style.display = "none"; hb.classList.remove("hold-good"); return; }
    hb.style.display = "";
    hb.classList.add("hold-good");
    hb.textContent = who === "me" ? "홀드 — 승리 확정 ✓" : "상대 홀드 — 상대 승리 확정";
  }

  function renderShieldReroll() {
    var sb = $("shieldRerollBtn");
    if (!sb) return;
    var show = ui.shield && ui.shield.starting && ui.shield.stage === "place" &&
      ui.shield.player === "me" && state[ui.shield.player].reroll;
    sb.style.display = show ? "" : "none";
  }

  function render() {
    renderBoard("oppBoard", "opp");
    renderBoard("myBoard", "me");
    renderVerdict();
    renderWinrate();
    renderHold();
    renderShieldReroll();
    // die 버튼 선택표시
    Array.prototype.forEach.call(document.querySelectorAll(".die-btn"), function (btn) {
      btn.classList.toggle("sel", ui.dice.indexOf(parseInt(btn.dataset.v, 10)) >= 0);
    });
    $("turnMe").classList.toggle("sel", ui.turn === "me");
    $("turnOpp").classList.toggle("sel", ui.turn === "opp");
    $("rerollBtn").style.display =
      (ui.turn === "me" && state.me.reroll && ui.dice.length === 1) ? "" : "none";
  }

  // ---------- 솔버 ----------
  function sims() { return Math.max(100, parseInt($("simsInput").value, 10) || 1500); }

  function evaluateMyTurn() {
    ui.fieldBest = {}; ui.rec = null;
    if (ui.turn !== "me" || !ui.dice.length) { render(); return; }
    var lines = [];
    ui.dice.forEach(function (dv) {
      var res = T.evaluateMoves(state, dv, sims());
      res.forEach(function (m) {
        var i = m.action.i;
        if (!ui.fieldBest[i] || m.winProb > ui.fieldBest[i].winProb) {
          ui.fieldBest[i] = { die: dv, winProb: m.winProb, action: m.action };
        }
      });
      res.forEach(function (m) {
        lines.push("눈 " + dv + " · " + (m.action.i + 1) + "번 " +
          (m.action.kind === "alkkagi" ? "알까기" : "배치") + " → " +
          (m.winProb * 100).toFixed(1) + "%");
      });
    });
    var bestP = -1;
    Object.keys(ui.fieldBest).forEach(function (k) {
      if (ui.fieldBest[k].winProb > bestP) { bestP = ui.fieldBest[k].winProb; ui.rec = parseInt(k, 10); }
    });
    $("results").textContent = lines.join("\n");
    $("actionHint").textContent = ui.rec != null
      ? ("추천: " + (ui.rec + 1) + "번 필드 클릭 (승률 " + (bestP * 100).toFixed(1) + "%)")
      : "둘 곳이 없습니다.";

    // 리롤 권장 여부 (한 눈 상태 + 리롤 보유 시). 리롤하면 두 눈 중 더 좋은 쪽 사용.
    var banner = $("rerollBanner"), rbtn = $("rerollBtn");
    banner.className = "rerollBanner"; rbtn.classList.remove("reroll-good");
    if (state.me.reroll && ui.dice.length === 1 && ui.rec != null) {
      var adv = rerollAdvice(bestP);
      if (adv.improvement >= 0.03) {
        banner.className = "rerollBanner show good";
        banner.textContent = "↻ 리롤 추천! 기대 승률 " + (adv.expected * 100).toFixed(1) +
          "% (현 눈 유지 " + (bestP * 100).toFixed(1) + "% → +" +
          (adv.improvement * 100).toFixed(1) + "%p)";
        rbtn.classList.add("reroll-good");
        rbtn.textContent = "리롤 ↻ +" + (adv.improvement * 100).toFixed(1) + "%p";
      } else {
        banner.className = "rerollBanner show bad";
        banner.textContent = "리롤 비추천 — 현 눈 유지가 나음 (리롤해도 " +
          (adv.improvement >= 0 ? "+" : "") + (adv.improvement * 100).toFixed(1) + "%p)";
        rbtn.textContent = "리롤";
      }
    } else {
      rbtn.textContent = "리롤";
    }
    render();
  }

  function rerollAdvice(keepBest) {
    var s = Math.max(150, Math.floor(sims() / 4));
    var total = 0;
    for (var v = 1; v <= 6; v++) {
      var r = T.evaluateMoves(state, v, s);
      var b = r.length ? r[0].winProb : 0;
      total += Math.max(keepBest, b); // 이전 눈도 그대로 쓸 수 있으므로 floor=keepBest
    }
    var expected = total / 6;
    return { expected: expected, improvement: expected - keepBest };
  }

  // 선턴 실드 리롤 조언: 새로 굴렸을 때(둘 중 선택) 기대 승률.
  function shieldRerollAdvice(keepBest, allowOpp) {
    var s = Math.max(150, Math.floor(sims() / 4));
    var total = 0;
    for (var v = 1; v <= 6; v++) {
      var r = T.evaluateShield(state, v, s, allowOpp);
      var b = r.length ? r[0].winProb : 0;
      total += Math.max(keepBest, b);
    }
    var expected = total / 6;
    return { expected: expected, improvement: expected - keepBest };
  }

  // ---------- 수 적용 ----------
  function clearSelection() {
    ui.dice = []; ui.fieldBest = {}; ui.rec = null;
    ui.oppFieldBest = {}; ui.oppRec = null;
    $("results").textContent = ""; $("actionHint").textContent = "";
    var banner = $("rerollBanner"), rbtn = $("rerollBtn");
    if (banner) banner.className = "rerollBanner";
    if (rbtn) { rbtn.classList.remove("reroll-good"); rbtn.textContent = "리롤"; }
  }

  function isDone(p) { return T.isDone(state[p]); }

  // 한 수 둔 뒤 다음 차례. 끝난(홀드/가득) 쪽은 건너뛰고, 양쪽 다 끝나면 종료.
  function advanceAfter(player) {
    var nxt = T.other(player);
    if (!isDone(nxt)) { setTurn(nxt); return; }
    if (!isDone(player)) { setTurn(player); return; }
    // 양쪽 다 끝남 — 게임 종료
    clearSelection();
    var w = T.winner(state);
    var name = { me: "나", opp: "상대", draw: "무승부" }[w];
    $("turnHint").textContent = "게임 종료 — " + name + (w === "draw" ? "" : " 승") + ".";
    render();
  }

  function setTurn(t) {
    ui.turn = t;
    clearSelection();
    $("turnHint").textContent = t === "me" ? "내 주사위 눈을 고르세요." : "상대 주사위 눈을 고르세요.";
    render();
  }

  function commitMove(player, die, action) {
    var pending = T.applyAction(state, die, action, player);
    clearSelection();
    if (pending) startShield(player, true);  // 실드 배치 후 턴 전환
    else advanceAfter(player);                // 자동 턴 전환 (꽉 찬 쪽 건너뜀)
  }

  // 게임 시작: 선턴(첫 차례) 선택 → 그 플레이어가 실드 주사위로 시작.
  function pickFirstPlayer() {
    ui.startPicking = true; ui.shield = null; ui.shieldEval = null;
    clearSelection();
    $("modalTitle").textContent = "선턴(첫 차례) 선택";
    $("modalHint").textContent = "누가 먼저 시작하나요? 선턴 플레이어는 실드 주사위로 시작합니다.";
    var host = $("modalDice"); host.innerHTML = "";
    [["me", "나 (왼쪽)"], ["opp", "상대 (오른쪽)"]].forEach(function (pair) {
      var b = document.createElement("button");
      b.className = "turnbtn"; b.textContent = pair[1];
      b.onclick = function () {
        ui.startPicking = false;
        $("modalBg").classList.remove("show");
        ui.turn = pair[0];
        startShield(pair[0], false, true); // 선턴 실드: 자기 판에만
      };
      host.appendChild(b);
    });
    $("modalBg").classList.add("show");
    render();
  }

  function startShield(player, allowOpp, starting) {
    ui.shield = { player: player, allowOpp: allowOpp, stage: "value", value: null, starting: !!starting };
    var who = player === "me" ? "내" : "상대";
    if (starting) {
      $("modalTitle").textContent = "선턴 실드 주사위";
      $("modalHint").textContent = who + " 선턴 실드 주사위 눈을 고르세요. (새로 굴리기 가능, " + who + " 판에만 배치)";
    } else {
      $("modalTitle").textContent = "알까기! 실드 주사위 눈";
      $("modalHint").textContent = (player === "me" ? "내가" : "상대가") + " 받은 실드 주사위 눈을 고르세요.";
    }
    var host = $("modalDice"); host.innerHTML = "";
    for (var v = 1; v <= 6; v++) {
      (function (val) {
        var b = document.createElement("button");
        b.className = "die-btn"; b.textContent = val;
        b.onclick = function () {
          ui.shield.value = val; ui.shield.stage = "place";
          $("modalBg").classList.remove("show");
          if (player === "me") computeShieldAdvice();
          else $("actionHint").textContent = "실드 주사위(" + val + ") 놓을 칸을 클릭하세요" +
            (allowOpp ? " (양쪽 가능)" : (player === "me" ? " (내 판만)" : " (상대 판만)"));
          render();
        };
        host.appendChild(b);
      })(v);
    }
    $("modalBg").classList.add("show");
    render();
  }

  function computeShieldAdvice() {
    ui.shieldEval = { map: {}, rec: null };
    var res = T.evaluateShield(state, ui.shield.value, sims(), ui.shield.allowOpp);
    var best = -1;
    res.forEach(function (r) {
      ui.shieldEval.map[r.spot.owner + ":" + r.spot.i] = r.winProb;
      if (r.winProb > best) { best = r.winProb; ui.shieldEval.rec = r.spot; }
    });
    var rc = ui.shieldEval.rec;
    $("actionHint").textContent = "실드(" + ui.shield.value + ") 추천: " +
      (rc.owner === "me" ? "내" : "상대") + " " + (rc.i + 1) + "번 필드 클릭 (승률 " +
      (best * 100).toFixed(1) + "%)";
    $("results").textContent = res.map(function (r) {
      return (r.spot.owner === "me" ? "내" : "상대") + " " + (r.spot.i + 1) + "번 → " +
        (r.winProb * 100).toFixed(1) + "%";
    }).join("\n");

    // 선턴 실드는 리롤 가능 → 다시 굴리는 게 나은지 권유.
    // 단, 리롤은 게임당 1회(일반 리롤과 공통)이므로 남아있을 때만. 알까기 실드는 리롤 불가.
    var banner = $("rerollBanner");
    if (ui.shield.starting && state[ui.shield.player].reroll) {
      var adv = shieldRerollAdvice(best, ui.shield.allowOpp);
      if (adv.improvement >= 0.03) {
        banner.className = "rerollBanner show good";
        banner.textContent = "↻ 선턴 실드 리롤 추천! 새로 굴리면 기대 " + (adv.expected * 100).toFixed(1) +
          "% (현재 눈 " + ui.shield.value + " 최선 배치 " + (best * 100).toFixed(1) + "% → +" +
          (adv.improvement * 100).toFixed(1) + "%p) — '↻ 실드 다시 굴리기' 클릭";
      } else {
        banner.className = "rerollBanner show bad";
        banner.textContent = "선턴 실드 리롤 비추천 — 현재 눈 " + ui.shield.value +
          " 유지가 나음 (리롤해도 +" + (adv.improvement * 100).toFixed(1) + "%p)";
      }
    } else {
      banner.className = "rerollBanner";
    }
  }

  function onFieldClick(owner, i) {
    var f = state[owner].fields[i];
    if (ui.shield && ui.shield.stage === "place") {
      if (f.length >= 3) return;
      if (owner !== ui.shield.player && !ui.shield.allowOpp) return;
      T.applyShield(state, ui.shield.value, { owner: owner, i: i }, ui.shield.player);
      var who = ui.shield.player;
      ui.shield = null; ui.shieldEval = null;
      $("actionHint").textContent = ""; $("results").textContent = "";
      advanceAfter(who);  // 알까기+실드 배치 끝 -> 자동 턴 전환 (꽉 찬 쪽 건너뜀)
      return;
    }
    if (!ui.dice.length) return;
    if (ui.turn === "me") {
      if (owner !== "me" || !ui.fieldBest[i]) return;
      var b = ui.fieldBest[i];
      commitMove("me", b.die, b.action);
    } else {
      if (owner !== "opp" || f.length >= 3) return;
      var acts = T.legalActions(state, ui.dice[0], "opp");
      var act = acts.filter(function (a) { return a.i === i; })[0];
      if (act) commitMove("opp", ui.dice[0], act);
    }
  }

  // ---------- 이벤트 ----------
  function selectDie(v) {
    ui.dice = [v];
    if (ui.turn === "me") {
      $("turnHint").textContent = "";
      evaluateMyTurn();
    } else {
      evaluateOppTurn();
    }
  }

  // 상대가 v를 둘 때 각 필드 배치별 '내 승률'을 표시.
  function evaluateOppTurn() {
    ui.oppFieldBest = {}; ui.oppRec = null;
    if (ui.turn !== "opp" || !ui.dice.length) { render(); return; }
    var res = T.evaluateMovesFor(state, ui.dice[0], "opp", sims());
    var lines = [], worst = 2;
    res.forEach(function (m) {
      ui.oppFieldBest[m.action.i] = { winProb: m.winProb, action: m.action };
      if (m.winProb < worst) { worst = m.winProb; ui.oppRec = m.action.i; }
      lines.push((m.action.i + 1) + "번 " + (m.action.kind === "alkkagi" ? "알까기" : "배치") +
        " → 내 승률 " + (m.winProb * 100).toFixed(1) + "%");
    });
    $("actionHint").textContent = "상대가 " + ui.dice[0] + "을 둔 필드를 클릭해 기록하세요." +
      (ui.oppRec != null ? " (상대 최선: " + (ui.oppRec + 1) + "번 → 그때 내 승률 " +
        (worst * 100).toFixed(1) + "%)" : "");
    $("results").textContent = lines.join("\n");
    render();
  }

  function buildDieButtons() {
    var host = $("dieBtns"); host.innerHTML = "";
    for (var v = 1; v <= 6; v++) {
      (function (val) {
        var b = document.createElement("button");
        b.className = "die-btn"; b.dataset.v = val; b.textContent = val;
        b.onclick = function () { selectDie(val); };
        host.appendChild(b);
      })(v);
    }
  }

  function init() {
    buildDieButtons();

    $("turnMe").onclick = function () { ui.turn = "me"; clearSelection(); $("turnHint").textContent = "내 주사위 눈을 고르세요."; render(); };
    $("turnOpp").onclick = function () { ui.turn = "opp"; clearSelection(); $("turnHint").textContent = "상대 주사위 눈을 고르세요."; render(); };

    $("rerollBtn").onclick = function () {
      if (!(ui.turn === "me" && state.me.reroll && ui.dice.length === 1)) return;
      $("modalTitle").textContent = "리롤 — 새 눈";
      $("modalHint").textContent = "리롤한 눈을 고르세요. (이전 눈 " + ui.dice[0] + " 도 그대로 선택 가능)";
      var host = $("modalDice"); host.innerHTML = "";
      for (var v = 1; v <= 6; v++) {
        (function (val) {
          var b = document.createElement("button");
          b.className = "die-btn"; b.textContent = val;
          b.onclick = function () {
            state.me.reroll = false;
            ui.dice = [ui.dice[0], val];
            $("modalBg").classList.remove("show");
            evaluateMyTurn();
          };
          host.appendChild(b);
        })(v);
      }
      $("modalBg").classList.add("show");
    };

    $("holdBtn").onclick = function () {
      if (!ui.dice.length || ui.shield || T.isTerminal(state)) return;
      var who = ui.turn;
      state[who].held = true;
      $("turnHint").textContent = (who === "me" ? "내가" : "상대가") + " 홀드함. ";
      advanceAfter(who); // 홀드한 쪽은 건너뜀 -> 상대만 진행
    };

    $("shieldRerollBtn").onclick = function () {
      if (!(ui.shield && ui.shield.starting && ui.shield.stage === "place")) return;
      if (!state[ui.shield.player].reroll) return;
      state[ui.shield.player].reroll = false; // 게임당 1회 리롤 소모(일반 리롤과 공통)
      $("rerollBanner").className = "rerollBanner";
      startShield(ui.shield.player, ui.shield.allowOpp, true); // 값 선택 모달 다시 열기
    };

    $("resetBtn").onclick = function () {
      state = T.newState(); ui.turn = "me"; ui.shield = null; ui.shieldEval = null;
      clearSelection(); render();
      pickFirstPlayer();
    };

    // 보드 클릭 위임
    ["oppBoard", "myBoard"].forEach(function (id) {
      $(id).addEventListener("click", function (ev) {
        var fld = ev.target.closest(".field");
        if (!fld) return;
        onFieldClick(fld.dataset.owner, parseInt(fld.dataset.index, 10));
      });
    });

    $("modalBg").addEventListener("click", function (ev) {
      // 배경 클릭 시 닫기 (실드 단계는 유지)
      if (ev.target === $("modalBg") && !ui.startPicking && (!ui.shield || ui.shield.stage !== "value")) {
        $("modalBg").classList.remove("show");
      }
    });

    $("turnHint").textContent = "내 주사위 눈을 고르세요.";
    render();
    pickFirstPlayer();
  }

  window.addEventListener("DOMContentLoaded", init);
})();
