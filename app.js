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
    shieldEval: null,// 실드 배치 추천: {map:{'owner:i':winProb}, rec:{owner,i}}
    history: [],     // 되돌리기용 상태 스냅샷 스택 [{st, turn}]
    log: [],         // 행동 이력 [{player, desc, wr}] — 매 수의 내 승률 추이
    started: false   // 게임 시작(선턴 선택) 전이면 빈 화면 + '게임 시작' 버튼
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
          var ev = ui.shieldEval.map[key];
          var sp = document.createElement("div");
          var isRec = ui.shieldEval.rec.owner === owner && ui.shieldEval.rec.i === i;
          sp.className = "winpill" + (isRec ? " best" : "");
          var tag = (ui.shield.values && ui.shield.values.length > 1) ? ("[" + ev.value + "] ") : "";
          sp.textContent = "실드 " + tag + (ev.winProb * 100).toFixed(0) + "%";
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
    if (!ui.started) { $("verdict").innerHTML = ""; return; }
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
    if (!ui.started) { lbl.innerHTML = ""; fill.style.width = "50%"; return; }
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
    $("undoBtn").disabled = !ui.history.length;
    $("restartBtn").style.display = (ui.started && T.isTerminal(state)) ? "" : "none";
    var sb = $("startBtn"); if (sb) sb.style.display = ui.started ? "none" : "";
    // 직전 수의 결과 승률을 이력에 채운다 (renderWinrate가 ui._wr 갱신 후).
    if (ui._logPending && ui._wr != null) { ui._logPending.wr = ui._wr; ui._logPending = null; }
    renderHistory();
  }

  // 행동 이력 테이블: 각 수 직후의 '내 승률'과 직전 대비 변화량.
  function renderHistory() {
    var panel = $("historyPanel"), tbl = $("histbl");
    if (!panel || !tbl) return;
    if (!ui.log.length) { panel.style.display = "none"; tbl.innerHTML = ""; return; }
    panel.style.display = "";
    var prev = null, out = [];
    ui.log.forEach(function (e, idx) {
      var wrTxt = e.wr == null ? "…" : (e.wr * 100).toFixed(0) + "%";
      var dTxt = "", dCls = "delta-flat";
      if (e.wr != null && prev != null) {
        var d = (e.wr - prev) * 100;
        dTxt = (d > 0 ? "+" : "") + d.toFixed(0) + "%p";
        dCls = d > 0.5 ? "delta-up" : (d < -0.5 ? "delta-down" : "delta-flat");
      } else if (e.wr != null) {
        dTxt = "—";
      }
      if (e.wr != null) prev = e.wr;
      out.push("<tr>" +
        "<td class='num'>" + (idx + 1) + "</td>" +
        "<td class='who-" + e.player + "'>" + (e.player === "me" ? "나" : "상대") + "</td>" +
        "<td>" + e.desc + "</td>" +
        "<td class='num wrcell'>" + wrTxt + "</td>" +
        "<td class='num " + dCls + "'>" + dTxt + "</td>" +
        "</tr>");
    });
    tbl.innerHTML =
      "<thead><tr><th class='num'>#</th><th>차례</th><th>행동</th>" +
      "<th class='num'>내 승률</th><th class='num'>Δ</th></tr></thead>" +
      "<tbody>" + out.reverse().join("") + "</tbody>";
  }

  // 보드를 바꾼 수를 이력에 기록(승률은 다음 render에서 채워짐).
  function recordLog(player, desc) {
    var e = { player: player, desc: desc, wr: null };
    ui.log.push(e);
    ui._logPending = e;
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
    var cur = ui.dice[0]; // 리롤은 원래 눈을 제외한 나머지 5개 중에서 나옴
    var total = 0, n = 0;
    for (var v = 1; v <= 6; v++) {
      if (v === cur) continue;
      var r = T.evaluateMoves(state, v, s);
      var b = r.length ? r[0].winProb : 0;
      total += Math.max(keepBest, b); // 이전 눈도 그대로 쓸 수 있으므로 floor=keepBest
      n++;
    }
    var expected = n ? total / n : keepBest;
    return { expected: expected, improvement: expected - keepBest };
  }

  // 선턴 실드 리롤 조언: 새로 굴렸을 때(둘 중 선택) 기대 승률.
  function shieldRerollAdvice(keepBest, allowOpp) {
    var s = Math.max(150, Math.floor(sims() / 4));
    var cur = ui.shield ? ui.shield.value : 0; // 리롤은 원래 눈 제외
    var total = 0, n = 0;
    for (var v = 1; v <= 6; v++) {
      if (v === cur) continue;
      var r = T.evaluateShield(state, v, s, allowOpp);
      var b = r.length ? r[0].winProb : 0;
      total += Math.max(keepBest, b);
      n++;
    }
    var expected = n ? total / n : keepBest;
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

  // 되돌리기: 보드를 바꾸는 수(배치/알까기/홀드) 직전에 스냅샷을 쌓는다.
  function snapshot() {
    ui.history.push({ st: T.clone(state), turn: ui.turn });
    if (ui.history.length > 80) ui.history.shift();
  }

  function undo() {
    if (!ui.history.length) return;
    var h = ui.history.pop();
    // 알까기 직후(실드 배치 전) 취소면 아직 로그가 없으므로 pop 안 함.
    if (ui._pendingAlk) ui._pendingAlk = null;
    else ui.log.pop(); // 스냅샷 1개 = 이력 1줄 (선턴 실드 baseline은 보존)
    state = h.st;
    ui.shield = null; ui.shieldEval = null;
    ui._wrSig = null; ui._holdSig = null;
    setTurn(h.turn); // clearSelection + 힌트 + render
  }

  function restartGame() {
    ui.history = []; ui.log = []; ui._logPending = null; ui._pendingAlk = null;
    state = T.newState(); ui.turn = "me"; ui.shield = null; ui.shieldEval = null;
    ui._wrSig = null; ui._holdSig = null;
    clearSelection(); render();
    pickFirstPlayer();
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
    // 알까기면 제거 정보를 미리 캡처(applyAction 후엔 사라짐) → 실드 배치 로그에 사용.
    var alk = null;
    if (action.kind === "alkkagi") {
      var foe = T.other(player);
      var removed = state[foe].fields[action.i].filter(function (d) {
        return d.value === die && !d.shield;
      }).length;
      alk = { side: player === "me" ? "상대" : "내", line: action.i + 1, value: die, removed: removed };
    }
    snapshot(); // 알까기면 실드 배치까지 한 수로 묶어 되돌림
    var pending = T.applyAction(state, die, action, player);
    if (!pending) recordLog(player, (action.i + 1) + "번 라인에 눈 " + die + " 배치");
    else ui._pendingAlk = alk; // 알까기는 실드 배치 시점에 한 줄로 기록
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
        ui.started = true;
        $("modalBg").classList.remove("show");
        ui.turn = pair[0];
        startShield(pair[0], false, true); // 선턴 실드: 자기 판에만
      };
      host.appendChild(b);
    });
    $("modalBg").classList.add("show");
    render();
  }

  function startShield(player, allowOpp, starting, exclude) {
    ui.shield = { player: player, allowOpp: allowOpp, stage: "value", value: null, starting: !!starting };
    var who = player === "me" ? "내" : "상대";
    if (starting) {
      $("modalTitle").textContent = "선턴 실드 주사위";
      $("modalHint").textContent = who + " 선턴 실드 주사위 눈을 고르세요. " +
        (exclude ? "(원래 눈 " + exclude + "은 제외)" : "(새로 굴리기 가능, " + who + " 판에만 배치)");
    } else {
      $("modalTitle").textContent = "알까기! 실드 주사위 눈";
      $("modalHint").textContent = (player === "me" ? "내가" : "상대가") + " 받은 실드 주사위 눈을 고르세요.";
    }
    var host = $("modalDice"); host.innerHTML = "";
    for (var v = 1; v <= 6; v++) {
      if (v === exclude) continue; // 리롤은 원래 눈 제외
      (function (val) {
        var b = document.createElement("button");
        b.className = "die-btn"; b.textContent = val;
        b.onclick = function () {
          ui.shield.value = val;
          // 리롤이면 원래 눈(exclude)과 새 눈 둘 다 후보 → 더 좋은 쪽 선택
          ui.shield.values = exclude ? [exclude, val] : [val];
          ui.shield.stage = "place";
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
    var values = ui.shield.values || [ui.shield.value]; // 리롤 시 [원래 눈, 새 눈]
    var multi = values.length > 1;
    var best = -1;
    values.forEach(function (val) {
      T.evaluateShield(state, val, sims(), ui.shield.allowOpp).forEach(function (r) {
        var key = r.spot.owner + ":" + r.spot.i, cur = ui.shieldEval.map[key];
        if (!cur || r.winProb > cur.winProb) ui.shieldEval.map[key] = { winProb: r.winProb, value: val };
        if (r.winProb > best) { best = r.winProb; ui.shieldEval.rec = r.spot; }
      });
    });
    var rc = ui.shieldEval.rec, rcv = ui.shieldEval.map[rc.owner + ":" + rc.i];
    $("actionHint").textContent = "실드 추천: " + (rc.owner === "me" ? "내" : "상대") + " " +
      (rc.i + 1) + "번 필드 클릭 (눈 " + rcv.value + ", 승률 " + (best * 100).toFixed(1) + "%)";
    $("results").textContent = Object.keys(ui.shieldEval.map).map(function (key) {
      var p = key.split(":"), e = ui.shieldEval.map[key];
      return (p[0] === "me" ? "내" : "상대") + " " + (parseInt(p[1], 10) + 1) + "번 → " +
        (multi ? "눈 " + e.value + " " : "") + (e.winProb * 100).toFixed(1) + "%";
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
      var skey = owner + ":" + i;
      var sval = (ui.shieldEval && ui.shieldEval.map[skey]) ? ui.shieldEval.map[skey].value : ui.shield.value;
      T.applyShield(state, sval, { owner: owner, i: i }, ui.shield.player);
      var who = ui.shield.player;
      var sside = owner === "me" ? "내" : "상대";
      var sdesc;
      if (ui.shield.starting) {
        sdesc = "선턴 실드 눈 " + sval + " → " + sside + " " + (i + 1) + "번 라인 배치";
      } else if (ui._pendingAlk) {
        var a = ui._pendingAlk;
        sdesc = "알까기 — " + a.side + " " + a.line + "번 라인 눈 " + a.value + " " +
          a.removed + "개 제거 → 실드(눈 " + sval + ") " + sside + " " + (i + 1) + "번 라인 배치";
      } else {
        sdesc = "알까기 실드(눈 " + sval + ") " + sside + " " + (i + 1) + "번 라인 배치";
      }
      recordLog(who, sdesc);
      ui._pendingAlk = null;
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
      var prev = ui.dice[0];
      $("modalTitle").textContent = "리롤 — 새 눈";
      $("modalHint").textContent = "리롤한 새 눈을 고르세요. (원래 눈 " + prev +
        "은 제외 — 이전 눈과 새 눈 중 더 좋은 쪽이 자동 비교됨)";
      var host = $("modalDice"); host.innerHTML = "";
      for (var v = 1; v <= 6; v++) {
        if (v === prev) continue; // 리롤은 원래 눈을 제외하고 나옴
        (function (val) {
          var b = document.createElement("button");
          b.className = "die-btn"; b.textContent = val;
          b.onclick = function () {
            state.me.reroll = false;
            ui.dice = [prev, val];
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
      snapshot();
      state[who].held = true;
      recordLog(who, "홀드");
      $("turnHint").textContent = (who === "me" ? "내가" : "상대가") + " 홀드함. ";
      advanceAfter(who); // 홀드한 쪽은 건너뜀 -> 상대만 진행
    };

    $("shieldRerollBtn").onclick = function () {
      if (!(ui.shield && ui.shield.starting && ui.shield.stage === "place")) return;
      if (!state[ui.shield.player].reroll) return;
      var prevV = ui.shield.value;
      state[ui.shield.player].reroll = false; // 게임당 1회 리롤 소모(일반 리롤과 공통)
      $("rerollBanner").className = "rerollBanner";
      startShield(ui.shield.player, ui.shield.allowOpp, true, prevV); // 원래 눈 제외하고 다시 열기
    };

    $("resetBtn").onclick = restartGame;
    $("restartBtn").onclick = restartGame;
    $("startBtn").onclick = pickFirstPlayer;
    $("undoBtn").onclick = undo;

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

    $("turnHint").textContent = "‘게임 시작’을 눌러 선턴을 정하세요.";
    render();
  }

  window.addEventListener("DOMContentLoaded", init);
})();
