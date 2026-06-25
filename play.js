/* 티카투카 혼자 플레이(샌드박스): 나(me) vs 그리디 AI(opp). engine.js(TIKA) 위에서 동작. */
(function () {
  "use strict";
  var T = window.TIKA;
  var $ = function (id) { return document.getElementById(id); };

  var state = T.newState();
  var S = {
    started: false,   // 플레이 한 번이라도 시작했는지(탭 진입 시 선턴 선택 띄울지)
    turn: null,       // 'me' | 'opp' | null(종료)
    over: false,
    busy: false,      // AI 처리 중(입력 잠금)
    wr: 0.5,          // 내 승률 캐시
    msg: "",
    hint: false,
    hintMap: null, hintRec: null,
    flash: null,      // 방금 바뀐 필드 강조 {owner, i, kind:'place'|'shield'|'alk'}
    log: [],          // 행동 이력 [{player, desc, wr}]
    // 사람이 놓아야 할 주사위: {kind:'place'|'shield', values:[..], sel, allowOpp, starting, canReroll}
    pend: null
  };

  function rollDistinct(prev) {
    var v; do { v = T.rollDie(); } while (v === prev);
    return v;
  }

  function computeWR() {
    var toMove = S.turn === "opp" ? "opp" : "me";
    S.wr = T.evaluatePosition(state, toMove, 400);
  }

  // 행동을 이력에 기록하고, 그 시점의 내 승률을 함께 저장.
  function recordLog(player, desc) {
    var nxt = T.other(player);
    var toMove = !T.isDone(state[nxt]) ? nxt : player;
    var wr = T.evaluatePosition(state, toMove, 400);
    S.log.push({ player: player, desc: desc, wr: wr });
    S.wr = wr;
  }

  function computeHint() {
    S.hintMap = null; S.hintRec = null;
    if (!S.hint || !S.pend || S.pend.kind !== "place" || S.turn !== "me") return;
    var res = T.evaluateMoves(state, S.pend.sel, 300);
    S.hintMap = {}; var best = -1;
    res.forEach(function (m) {
      S.hintMap[m.action.i] = { winProb: m.winProb, kind: m.action.kind };
      if (m.winProb > best) { best = m.winProb; S.hintRec = m.action.i; }
    });
  }

  // 주사위 굴림 애니메이션: pDice에서 눈을 빠르게 바꾸다 finalVal로 멈춤.
  function animateRoll(finalVal, kind, done) {
    S.busy = true; render();
    var host = $("pDice"); host.innerHTML = "";
    var d = document.createElement("div");
    d.className = "die rolling" + (kind === "shield" ? " shield" : "");
    d.textContent = "?"; host.appendChild(d);
    var ticks = 0;
    var iv = setInterval(function () {
      ticks++;
      d.textContent = 1 + ((Math.random() * 6) | 0);
      if (ticks >= 13) {
        clearInterval(iv);
        d.textContent = finalVal;
        d.classList.remove("rolling"); d.classList.add("pop");
        // 멈춘 눈을 확실히 보여준 뒤 다음 단계로.
        setTimeout(function () { S.busy = false; done(); }, 650);
      }
    }, 80);
  }

  // ---------- 렌더 ----------
  function pDie(d, pop) {
    var e = document.createElement("div");
    e.className = "die" + (d.shield ? " shield" : "") + (pop ? " pop" : "");
    if (d.shield && d.by) e.classList.add(d.by === "me" ? "shield-me" : "shield-opp");
    e.textContent = d.value;
    return e;
  }

  function pBoard(boardId, owner) {
    var host = $(boardId); host.innerHTML = "";
    var ms = T.boardScores(state.me), os = T.boardScores(state.opp);
    var myS = owner === "me" ? ms : os, opS = owner === "me" ? os : ms;
    for (var i = 0; i < 3; i++) {
      var f = state[owner].fields[i];
      var div = document.createElement("div");
      div.className = "field"; div.dataset.owner = owner; div.dataset.index = i;
      if (myS[i] > opS[i]) div.classList.add("win");
      else if (myS[i] < opS[i]) div.classList.add("lose");

      var fl = S.flash, isFlash = fl && fl.owner === owner && fl.i === i;
      if (isFlash) div.classList.add(fl.kind === "alk" ? "flash-alk" : "flash");
      var popNew = isFlash && (fl.kind === "place" || fl.kind === "shield");

      var clickable = false;
      if (S.pend && S.turn === "me" && !S.busy && !S.over) {
        if (S.pend.kind === "shield") clickable = f.length < 3 && (owner === "me" || S.pend.allowOpp);
        else if (S.pend.kind === "place" && owner === "me") clickable = f.length < 3;
      }
      if (clickable) div.classList.add("clickable");

      if (S.hint && S.hintMap && owner === "me" && S.pend && S.pend.kind === "place" && (i in S.hintMap)) {
        var hm = S.hintMap[i];
        var pill = document.createElement("div");
        pill.className = "winpill" + (hm.kind === "alkkagi" ? " alk" : "") + (i === S.hintRec ? " best" : "");
        pill.textContent = (hm.kind === "alkkagi" ? "알까기 " : "") + (hm.winProb * 100).toFixed(0) + "%";
        div.appendChild(pill);
        if (i === S.hintRec) div.classList.add("recommend");
      }

      var slots = document.createElement("div"); slots.className = "slots";
      var mkE = function () { var s = document.createElement("div"); s.className = "slot-empty"; return s; };
      if (owner === "me") {
        for (var e = f.length; e < 3; e++) slots.appendChild(mkE());
        for (var k = f.length - 1; k >= 0; k--) slots.appendChild(pDie(f[k], popNew && k === f.length - 1));
      } else {
        for (var k2 = 0; k2 < f.length; k2++) slots.appendChild(pDie(f[k2], popNew && k2 === f.length - 1));
        for (var e2 = f.length; e2 < 3; e2++) slots.appendChild(mkE());
      }
      var sc = document.createElement("div"); sc.className = "fscore";
      sc.innerHTML = (i + 1) + "번 · <b>" + myS[i] + "</b>";
      div.appendChild(slots); div.appendChild(sc); host.appendChild(div);
    }
  }

  function renderDice() {
    var host = $("pDice"); host.innerHTML = "";
    if (!S.pend) return;
    S.pend.values.forEach(function (v) {
      var e = document.createElement("div");
      e.className = "die" + (S.pend.kind === "shield" ? " shield" : "");
      if (S.pend.values.length > 1) {
        e.classList.add("cand"); if (v === S.pend.sel) e.classList.add("sel");
        e.dataset.v = v;
      }
      e.textContent = v; host.appendChild(e);
    });
  }

  function renderHistory() {
    var panel = $("pHistoryPanel"), tbl = $("pHistbl");
    if (!S.log.length) { panel.style.display = "none"; return; }
    panel.style.display = "";
    var rows = "<thead><tr><th class='num'>#</th><th>차례</th><th>행동</th>" +
      "<th class='num'>내 승률</th><th class='num'>Δ</th></tr></thead><tbody>";
    var prev = null, out = [];
    S.log.forEach(function (e, idx) {
      var who = e.player === "me"
        ? "<span class='who-me'>나</span>" : "<span class='who-opp'>상대</span>";
      var wrTxt = e.wr == null ? "–" : (e.wr * 100).toFixed(0) + "%";
      var dCell = "<span class='delta-flat'>–</span>";
      if (e.wr != null && prev != null) {
        var d = (e.wr - prev) * 100;
        var cls = d > 0.5 ? "delta-up" : d < -0.5 ? "delta-down" : "delta-flat";
        var sign = d > 0.5 ? "▲" : d < -0.5 ? "▼" : "•";
        dCell = "<span class='" + cls + "'>" + sign + " " + Math.abs(d).toFixed(0) + "%p</span>";
      }
      if (e.wr != null) prev = e.wr;
      out.push("<tr><td class='num'>" + (idx + 1) + "</td><td>" + who + "</td><td>" + e.desc +
        "</td><td class='num wrcell'>" + wrTxt + "</td><td class='num'>" + dCell + "</td></tr>");
    });
    tbl.innerHTML = rows + out.reverse().join("") + "</tbody>";
  }

  function render() {
    pBoard("pOppBoard", "opp"); pBoard("pMyBoard", "me");
    $("pMyBoard").className = "board" + (!S.over && S.turn === "me" ? " glow-me" : "");
    $("pOppBoard").className = "board" + (!S.over && S.turn === "opp" ? " glow-opp" : "");
    var wnr = T.winner(state);
    var totals = "<span class='hint'>(총합 나 " + T.boardTotal(state.me) + " : 상대 " + T.boardTotal(state.opp) + ")</span>";
    if (S.over) {
      var w = { me: "내 승리!", opp: "상대(AI) 승리", draw: "무승부" }[wnr];
      var col = wnr === "me" ? "var(--win)" : wnr === "opp" ? "var(--opp)" : "var(--muted)";
      $("pVerdict").innerHTML = "<b style='color:" + col + "'>" + w + "</b> " + totals;
    } else {
      var badge = S.turn === "me"
        ? "<span class='turn-badge me'>● 내 턴</span>"
        : "<span class='turn-badge opp'>● 상대 AI</span>";
      var name = { me: "나", opp: "상대", draw: "막상막하" }[wnr];
      $("pVerdict").innerHTML = badge + " &nbsp; 우세 <b>" + name + "</b> " + totals;
    }
    $("pWrFill").style.width = (S.wr * 100).toFixed(1) + "%";
    $("pWrLabel").innerHTML = "내 승률 <b>" + (S.wr * 100).toFixed(0) + "%</b>";
    renderDice();
    $("pRoll").style.display = (S.turn === "me" && !S.pend && !S.over && !S.busy) ? "" : "none";
    var canRe = S.pend && S.pend.canReroll && state.me.reroll &&
      S.pend.values.length === 1 && S.turn === "me" && !S.busy && !S.over;
    $("pReroll").style.display = canRe ? "" : "none";
    $("pHold").style.display =
      (S.turn === "me" && !S.busy && !S.over && (!S.pend || S.pend.kind !== "shield")) ? "" : "none";
    $("pMsg").textContent = S.msg || "";
    renderHistory();
  }

  // ---------- 턴 진행 ----------
  function advance(player) {
    if (T.isTerminal(state)) { endGame(); return; }
    var nxt = T.other(player);
    if (!T.isDone(state[nxt])) { setTurn(nxt); return; }
    if (!T.isDone(state[player])) { setTurn(player); return; }
    endGame();
  }

  function setTurn(p) {
    S.turn = p;
    if (p === "me") {
      S.pend = null; S.hintMap = null;
      if (!S.msg) S.msg = "내 턴 — '주사위 굴리기'를 누르세요.";
      computeWR(); render();
    } else {
      render(); aiMove();
    }
  }

  function endGame() {
    S.over = true; S.turn = null; S.pend = null; S.busy = false; S.hintMap = null;
    computeWR();
    var wnr = T.winner(state);
    S.msg = "게임 종료 — " + { me: "내 승!", opp: "상대(AI) 승", draw: "무승부" }[wnr] + " · '새 게임'으로 다시.";
    render();
  }

  // ---------- 사람 입력 ----------
  function humanRoll() {
    if (S.turn !== "me" || S.pend || S.over || S.busy) return;
    S.flash = null;
    var v = T.rollDie();
    animateRoll(v, "place", function () {
      S.pend = { kind: "place", values: [v], sel: v, allowOpp: false, starting: false, canReroll: true };
      S.msg = "눈 " + v + " — 놓을 라인을 클릭" + (state.me.reroll ? " (리롤 가능)" : "");
      computeHint(); render();
    });
  }

  function reroll() {
    if (!S.pend || !S.pend.canReroll || !state.me.reroll) return;
    if (S.pend.values.length > 1 || S.turn !== "me" || S.busy) return;
    var orig = S.pend.values[0], nv = rollDistinct(orig), kind = S.pend.kind;
    state.me.reroll = false;
    S.pend.values = [orig, nv]; S.pend.sel = nv;
    animateRoll(nv, kind, function () {
      S.msg = "리롤! 눈 " + orig + " / " + nv + " 중 하나를 골라 라인을 클릭";
      computeHint(); render();
    });
  }

  function selectCand(v) {
    if (!S.pend || S.pend.values.indexOf(v) < 0) return;
    S.pend.sel = v; computeHint(); render();
  }

  function hold() {
    if (S.turn !== "me" || S.busy || S.over) return;
    if (S.pend && S.pend.kind === "shield") return;
    state.me.held = true; S.pend = null;
    S.msg = "홀드 — 더 두지 않고 상대만 진행시킵니다.";
    recordLog("me", "홀드");
    advance("me");
  }

  function fieldClick(owner, i) {
    if (S.over || S.busy || !S.pend || S.turn !== "me") return;
    var f = state[owner].fields[i];
    if (S.pend.kind === "shield") {
      if (f.length >= 3) return;
      if (owner !== "me" && !S.pend.allowOpp) return;
      var starting = S.pend.starting, sv = S.pend.sel;
      T.applyShield(state, sv, { owner: owner, i: i }, "me");
      S.pend = null;
      S.flash = { owner: owner, i: i, kind: "shield" };
      var sside = owner === "me" ? "내" : "상대";
      S.msg = (starting ? "선턴 실드" : "알까기 실드") + "(눈 " + sv + ") " +
        sside + " " + (i + 1) + "번 라인 배치.";
      var sdesc;
      if (starting) {
        sdesc = "선턴 실드 눈 " + sv + " → " + sside + " " + (i + 1) + "번 라인 배치";
      } else if (S.pendAlk) {
        var a = S.pendAlk;
        sdesc = "알까기 — 상대 " + a.line + "번 라인 눈 " + a.value + " " + a.removed +
          "개 제거 → 실드(눈 " + sv + ") " + sside + " " + (i + 1) + "번 라인 배치";
      } else {
        sdesc = "알까기 실드(눈 " + sv + ") " + sside + " " + (i + 1) + "번 라인 배치";
      }
      S.pendAlk = null;
      recordLog("me", sdesc);
      advance("me");
      return;
    }
    // place
    if (owner !== "me") return;
    var acts = T.legalActions(state, S.pend.sel, "me");
    var act = acts.filter(function (a) { return a.i === i; })[0];
    if (!act) return;
    var val = S.pend.sel;
    var removed = state.opp.fields[act.i].filter(function (d) {
      return d.value === val && !d.shield;
    }).length;
    var pending = T.applyAction(state, val, act, "me");
    if (pending) {
      S.pend = null;
      S.pendAlk = { line: act.i + 1, value: val, removed: removed };
      S.flash = { owner: "opp", i: act.i, kind: "alk" }; // 튕겨낸 상대 라인 강조
      S.busy = true;
      S.msg = "알까기! 상대 " + (act.i + 1) + "번 라인 눈 " + val + " " + removed +
        "개 제거 — 실드 굴리는 중…";
      S.hintMap = null; render();
      setTimeout(function () { // 알까기 발동을 눈으로 확인할 시간
        var ssv = T.rollDie();
        animateRoll(ssv, "shield", function () {
          S.pend = { kind: "shield", values: [ssv], sel: ssv, allowOpp: true, starting: false, canReroll: false };
          S.msg = "실드 눈 " + ssv + " — 놓을 라인 클릭 (양쪽 가능)";
          render();
        });
      }, 1500);
      return;
    }
    S.pend = null;
    S.flash = { owner: "me", i: act.i, kind: "place" };
    S.msg = (act.i + 1) + "번 라인에 눈 " + val + " 배치.";
    recordLog("me", (act.i + 1) + "번 라인에 눈 " + val + " 배치");
    advance("me");
  }

  // ---------- AI ----------
  function aiMove() {
    if (S.over) return;
    S.busy = true; S.msg = "상대 AI 차례…"; render();
    setTimeout(doAi, 350);
  }

  function doAi() {
    if (S.over) { S.busy = false; return; }
    if (T.isDone(state.opp)) { S.busy = false; advance("opp"); return; }
    S.flash = null;
    var v = T.rollDie();
    animateRoll(v, "place", function () {
      var acts = T.legalActions(state, v, "opp");
      if (!acts.length) {
        S.msg = "상대 눈 " + v + " — 둘 곳 없음, 패스";
        recordLog("opp", "눈 " + v + " — 둘 곳 없어 패스");
        render();
        setTimeout(function () { advance("opp"); }, 450); return;
      }
      var act = T.greedyAction(state, v, acts, "opp");
      // 알까기면 내 라인의 같은 눈 개수(제거될 수) 미리 집계.
      var removed = state.me.fields[act.i].filter(function (d) {
        return d.value === v && !d.shield;
      }).length;
      var pending = T.applyAction(state, v, act, "opp");
      if (pending) {
        // 1단계: 알까기 발동을 먼저 보여주고 잠시 멈춤.
        S.flash = { owner: "me", i: act.i, kind: "alk" }; // 튕겨나간 내 라인 강조
        S.msg = "상대 알까기! 내 " + (act.i + 1) + "번 라인 눈 " + v + " " + removed +
          "개 제거 — 실드 굴리는 중…";
        render();
        setTimeout(function () {
          var sv = T.rollDie();
          // 실드는 양쪽에 둘 수 있어 '칸 막기' 가치가 중요 → 몬테카를로로 평가(그리디 X).
          animateRoll(sv, "shield", function () {
            var spot = T.evaluateShieldFor(state, sv, "opp", 250, true)[0].spot;
            T.applyShield(state, sv, spot, "opp");
            var sside = spot.owner === "me" ? "내" : "상대";
            S.flash = { owner: spot.owner, i: spot.i, kind: "shield" };
            S.msg = "상대: 실드(" + sv + ") " + sside + " " + (spot.i + 1) + "번 라인 배치";
            recordLog("opp", "알까기 — 내 " + (act.i + 1) + "번 라인 눈 " + v + " " + removed +
              "개 제거 → 실드(눈 " + sv + ") " + sside + " " + (spot.i + 1) + "번 라인 배치");
            render();
            setTimeout(function () { advance("opp"); }, 850);
          });
        }, 1500);
        return;
      }
      S.flash = { owner: "opp", i: act.i, kind: "place" };
      S.msg = "상대: 눈 " + v + " → " + (act.i + 1) + "번 라인 배치";
      recordLog("opp", (act.i + 1) + "번 라인에 눈 " + v + " 배치");
      render();
      setTimeout(function () { advance("opp"); }, 500);
    });
  }

  // ---------- 게임 시작 ----------
  function openStart() {
    S.started = true;
    var first = Math.random() < 0.5 ? "me" : "opp";
    var host = $("pStartDice"); host.innerHTML = "";
    var msg = document.createElement("div");
    msg.style.cssText = "font-size:17px;font-weight:800;color:var(--muted)";
    msg.textContent = "선턴 추첨 중…";
    host.appendChild(msg);
    $("pStartBg").classList.add("show");
    setTimeout(function () {
      msg.style.color = first === "me" ? "var(--me)" : "var(--opp)";
      msg.textContent = "선턴: " + (first === "me" ? "나!" : "상대 AI!");
      setTimeout(function () {
        $("pStartBg").classList.remove("show");
        startGame(first);
      }, 850);
    }, 650);
  }

  function startGame(first) {
    state = T.newState();
    S.over = false; S.busy = false; S.pend = null; S.hintMap = null; S.flash = null; S.wr = 0.5;
    S.log = []; S.pendAlk = null;
    if (first === "me") {
      S.turn = "me";
      var sv = T.rollDie();
      S.pend = { kind: "shield", values: [sv], sel: sv, allowOpp: false, starting: true, canReroll: true };
      S.msg = "선턴! 실드 눈 " + sv + " — 내 라인에 배치" + (state.me.reroll ? " (리롤 가능)" : "");
      computeWR(); render();
    } else {
      S.turn = "opp"; S.msg = "상대 AI가 선턴 실드를 놓는 중…"; computeWR(); render();
      setTimeout(function () {
        var sv = T.rollDie();
        animateRoll(sv, "shield", function () {
          var spots = T.shieldSpots(state, "opp", false);
          var spot = T.greedyShield(state, sv, spots, "opp");
          T.applyShield(state, sv, spot, "opp");
          S.flash = { owner: "opp", i: spot.i, kind: "shield" };
          S.msg = "상대: 선턴 실드(" + sv + ") " + (spot.i + 1) + "번 라인 배치";
          recordLog("opp", "선턴 실드 눈 " + sv + " → 상대 " + (spot.i + 1) + "번 라인 배치");
          render();
          setTimeout(function () { advance("opp"); }, 500);
        });
      }, 350);
    }
  }

  // ---------- 탭 ----------
  function showTab(which) {
    var adv = which === "adv";
    $("paneAdvisor").style.display = adv ? "" : "none";
    $("panePlay").style.display = adv ? "none" : "";
    $("tabAdvisor").classList.toggle("sel", adv);
    $("tabPlay").classList.toggle("sel", !adv);
    if (!adv) { if (!S.started) openStart(); else render(); }
  }

  function init() {
    $("pRoll").onclick = humanRoll;
    $("pReroll").onclick = reroll;
    $("pHold").onclick = hold;
    $("pNew").onclick = openStart;
    $("pHint").onchange = function () { S.hint = this.checked; computeHint(); render(); };
    $("pDice").addEventListener("click", function (ev) {
      var el = ev.target.closest(".cand");
      if (el && el.dataset.v) selectCand(parseInt(el.dataset.v, 10));
    });
    ["pOppBoard", "pMyBoard"].forEach(function (id) {
      $(id).addEventListener("click", function (ev) {
        var fld = ev.target.closest(".field");
        if (fld) fieldClick(fld.dataset.owner, parseInt(fld.dataset.index, 10));
      });
    });
    $("tabAdvisor").onclick = function () { showTab("adv"); };
    $("tabPlay").onclick = function () { showTab("play"); };
    render();
  }

  window.addEventListener("DOMContentLoaded", init);
})();
