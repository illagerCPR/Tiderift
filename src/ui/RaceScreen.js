// RaceScreen.js -- 御风赛道界面（建赛道 / 选点 / 开始 / 编辑 / 删除 / 看成绩）
import { onLocaleChange, t } from '../i18n/index.js';
import {
  RACE_NAME_MAX, RACE_POINT_MIN, RACE_POINT_MAX, RACE_SEGMENT_MAX,
  RACE_MODES, RACE_TRACK_LIMIT, newRaceId, sanitizeTrack,
} from '../core/RaceTracks.js';
import { formatRaceTime } from '../core/RaceRun.js';

// 中文方位词序为「东西在前、南北在后」：东北 / 西北 / 东南 / 西南
function compassLabel(dx, dz) {
  const ew = dx > 0 ? t('东') : (dx < 0 ? t('西') : '');
  const ns = dz < 0 ? t('北') : (dz > 0 ? t('南') : '');
  return (ew + ns) || t('原地');
}

function modeLabel(mode) {
  return mode === 'free' ? t('自由（创造飞行）') : t('御风（鞘翅与气流）');
}

export class RaceScreen {
  constructor(game) {
    this.game = game;
    this.visible = false;
    this.draft = null;        // null：不在建/改；否则 {id, revision, name, mode, points}
    this._confirmDelete = ''; // 二次确认的赛道 id
    this._pending = false;    // 已发保存、等服务器回执（仅联机）
    this._wasPaused = false;
    this.onHide = null;

    this.el = document.createElement('div');
    this.el.style.cssText = `position:absolute;inset:0;display:none;align-items:center;justify-content:center;z-index:56;
      background:rgba(0,0,0,.72);color:#eee;font-family:'Segoe UI','Microsoft YaHei',sans-serif;`;
    this.panel = document.createElement('div');
    this.panel.style.cssText = `width:min(660px,95vw);max-height:min(680px,93vh);overflow:auto;background:#1d2429;border:3px solid #5f8f95;
      box-shadow:0 0 0 2px #0d1413;display:flex;flex-direction:column;padding:16px;gap:12px;`;
    this.el.appendChild(this.panel);
    this._onKey = (e) => {
      if (e.key === 'Escape' && this.visible) { e.stopPropagation(); e.preventDefault(); this.hide(); }
    };
    document.addEventListener('keydown', this._onKey, true);
    this.el.addEventListener('click', (e) => { if (e.target === this.el) this.hide(); });
    this._unbindLocale = onLocaleChange(() => { if (this.visible) this.render(); });
    document.body.appendChild(this.el);
  }

  _button(label, onClick, disabled = false) {
    const button = document.createElement('button');
    button.textContent = t(label);
    button.disabled = !!disabled;
    button.style.cssText = `padding:6px 11px;background:${disabled ? '#262d31' : '#33454a'};color:${disabled ? '#76838a' : '#eee'};
      border:1px solid #7d9aa0;cursor:${disabled ? 'default' : 'pointer'};`;
    if (!disabled) button.addEventListener('click', onClick);
    return button;
  }

  _line(text, style = '') {
    const div = document.createElement('div');
    div.textContent = text;
    div.style.cssText = `font-size:13px;color:#c2d3d6;${style}`;
    return div;
  }

  _row(css = '') {
    const div = document.createElement('div');
    div.style.cssText = `display:flex;gap:8px;align-items:center;flex-wrap:wrap;${css}`;
    return div;
  }

  show() {
    this._wasPaused = !!this.game.paused;
    this.visible = true;
    this.el.style.display = 'flex';
    this._confirmDelete = '';
    this.render();
    if (this.game.controls) {
      this.game.controls.enabled = false;
      this.game.controls.mouseLeft = false;
      this.game.controls.mouseRight = false;
    }
    if (document.pointerLockElement) document.exitPointerLock();
  }

  hide() {
    if (!this.visible) return;
    this.visible = false;
    this.el.style.display = 'none';
    this.draft = null;
    this._pending = false;
    if (this.game.controls) this.game.controls.enabled = this._wasPaused ? false : true;
    if (this.onHide) { const fn = this.onHide; this.onHide = null; fn(); }
  }

  dispose() {
    if (this.visible) this.hide();
    document.removeEventListener('keydown', this._onKey, true);
    if (this._unbindLocale) { this._unbindLocale(); this._unbindLocale = null; }
    this.el.remove();
    this.onHide = null;
    this.draft = null;
  }

  // 服务器回执（联机）：保存成功 → 关草稿；保存被拒 → 解锁按钮
  onTrackSaved(track, mine) {
    this._pending = false;
    if (!mine) { if (this.visible) this.render(); return; }
    this.draft = null;
    if (this.visible) this.render();
  }

  onTrackDenied() {
    this._pending = false;
    if (this.visible) this.render();
  }

  _posts() {
    return this.game._racePosts ? this.game._racePosts() : [];
  }

  _startDraft(track) {
    if (track) {
      this.draft = {
        id: track.id,
        revision: track.revision,
        name: track.name,
        mode: track.mode,
        points: track.points.map((p) => ({ x: p.x, y: p.y, z: p.z })),
      };
    } else {
      this.draft = { id: newRaceId(), revision: 0, name: '', mode: RACE_MODES[0], points: [] };
    }
    this._confirmDelete = '';
    this.render();
  }

  _roleLabel(index, total) {
    if (index === 0) return t('起点');
    if (index === total - 1) return t('终点');
    return t('检查点 {n}', { n: index });
  }

  render() {
    this.panel.replaceChildren();
    const game = this.game;
    const dim = game.world ? game.world.dimension : 'overworld';
    const tracks = game.races ? game.races.list(dim) : [];
    const posts = this._posts();

    const title = document.createElement('div');
    title.textContent = t('御风赛道');
    title.style.cssText = 'font-size:17px;font-weight:bold;color:#9fe8dc;';
    this.panel.appendChild(title);
    this.panel.appendChild(this._line(t('本维赛道：{n} 条 · 附近标桩：{m} 根', { n: tracks.length, m: posts.length }), 'color:#8ea7a2;'));

    if (this.draft) this._renderDraft(posts);
    else {
      const row = this._row();
      row.appendChild(this._button('新建赛道', () => this._startDraft(null), tracks.length >= RACE_TRACK_LIMIT));
      if (tracks.length >= RACE_TRACK_LIMIT) row.appendChild(this._line(t('赛道数量已达上限'), 'color:#e89a8a;'));
      this.panel.appendChild(row);
    }

    // ── 赛道列表 ──
    const listBox = document.createElement('div');
    listBox.style.cssText = 'display:flex;flex-direction:column;gap:8px;border-top:1px solid #3a4a4d;padding-top:10px;';
    if (!tracks.length) {
      listBox.appendChild(this._line(t('这一维度还没有赛道。'), 'color:#8ea7a2;'));
    }
    for (const track of tracks) {
      const card = document.createElement('section');
      card.style.cssText = 'border:1px solid #3a4a4d;background:#161d21;padding:9px 10px;display:flex;flex-direction:column;gap:5px;';
      const valid = game._raceTrackValidity ? game._raceTrackValidity(track) : { ok: true, badIndex: -1 };
      const head = document.createElement('div');
      head.textContent = t('{name} · 修订 {rev}', { name: track.name, rev: track.revision });
      head.style.cssText = 'font-size:14px;font-weight:bold;color:#e4f2ee;';
      card.appendChild(head);
      card.appendChild(this._line(t('{mode} · {p} 个点位 · 全长 {len} 格', { mode: modeLabel(track.mode), p: track.points.length, len: game._raceTrackLength(track) }), 'color:#9fb6b2;'));

      const bestMine = game._raceBest(track);
      const bestRoom = game._raceRoomBest(track);
      const lines = [];
      if (bestMine !== null) lines.push(t('个人最佳 {t}', { t: formatRaceTime(bestMine) }));
      if (bestRoom) lines.push(t('房间最佳 {t}（{who}）', { t: formatRaceTime(bestRoom.ms), who: bestRoom.name || t('其他玩家') }));
      if (lines.length) card.appendChild(this._line(lines.join(' · '), 'color:#ffe0a0;'));

      if (!valid.ok) {
        const bad = track.points[valid.badIndex];
        card.appendChild(this._line(t('标桩已缺失（{x}, {y}, {z}），赛道上不了路；请编辑后重新保存。', { x: bad.x, y: bad.y, z: bad.z }), 'color:#e89a8a;'));
      }

      const buttons = this._row();
      buttons.appendChild(this._button('开始', () => this._start(track), !valid.ok));
      buttons.appendChild(this._button('编辑', () => this._startDraft(track)));
      if (this._confirmDelete === track.id) {
        buttons.appendChild(this._button('确定删除', () => this._delete(track)));
        buttons.appendChild(this._button('取消', () => { this._confirmDelete = ''; this.render(); }));
      } else {
        buttons.appendChild(this._button('删除', () => { this._confirmDelete = track.id; this.render(); }));
      }
      card.appendChild(buttons);
      listBox.appendChild(card);
    }
    this.panel.appendChild(listBox);
    this.panel.appendChild(this._button('关闭 (ESC)', () => this.hide()));
  }

  _renderDraft(posts) {
    const draft = this.draft;
    const editing = !!draft.revision;
    const box = document.createElement('section');
    box.style.cssText = 'border:1px solid #4a6f74;background:#141b1f;padding:10px;display:flex;flex-direction:column;gap:7px;';

    const head = document.createElement('div');
    head.textContent = editing ? t('编辑赛道') : t('新建赛道');
    head.style.cssText = 'font-size:15px;font-weight:bold;color:#9fe8dc;';
    box.appendChild(head);

    // 名称
    const nameRow = this._row();
    nameRow.appendChild(this._line(t('赛道名称'), 'min-width:72px;'));
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = RACE_NAME_MAX;
    input.value = draft.name;
    input.placeholder = t('未命名赛道');
    input.style.cssText = 'flex:1;min-width:180px;padding:5px 7px;background:#0f1518;color:#e8f4ef;border:1px solid #5f8f95;font-size:13px;';
    input.addEventListener('input', () => { draft.name = input.value; });
    input.addEventListener('keydown', (e) => e.stopPropagation()); // 输入框内打字不触发世界快捷键
    nameRow.appendChild(input);
    box.appendChild(nameRow);

    // 模式
    const modeRow = this._row();
    modeRow.appendChild(this._line(t('计时模式'), 'min-width:72px;'));
    for (const mode of RACE_MODES) {
      const active = draft.mode === mode;
      const btn = this._button(mode === 'free' ? '自由（创造飞行）' : '御风（鞘翅与气流）', () => { draft.mode = mode; this.render(); });
      btn.style.borderColor = active ? '#9fe8dc' : '#5f8f95';
      btn.style.background = active ? '#2f5a55' : '#33454a';
      modeRow.appendChild(btn);
    }
    box.appendChild(modeRow);
    box.appendChild(this._line(t('两种模式各自单独统计成绩，不混榜。'), 'color:#7f9a96;'));

    // 已选点位
    box.appendChild(this._line(t('已选点位（{n}/{max}）', { n: draft.points.length, max: RACE_POINT_MAX }), 'color:#cfe6df;'));
    const pointList = document.createElement('div');
    pointList.style.cssText = 'display:flex;flex-direction:column;gap:4px;';
    draft.points.forEach((point, index) => {
      const row = this._row();
      row.appendChild(this._line(t('{role} · ({x}, {y}, {z})', {
        role: this._roleLabel(index, draft.points.length), x: point.x, y: point.y, z: point.z,
      })));
      row.appendChild(this._button('移除', () => { draft.points.splice(index, 1); this.render(); }));
      pointList.appendChild(row);
    });
    if (!draft.points.length) pointList.appendChild(this._line(t('还没有点位：先用御风标桩在世界上摆好位置，再按顺序加入。'), 'color:#8ea7a2;'));
    else if (draft.points.length < RACE_POINT_MIN) pointList.appendChild(this._line(t('至少需要 3 个点位：起点、检查点、终点。'), 'color:#e89a8a;'));
    box.appendChild(pointList);

    // 从草稿里的点位算间距提示
    for (let i = 1; i < draft.points.length; i++) {
      const a = draft.points[i - 1];
      const b = draft.points[i];
      const dist = Math.round(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
      if (dist > RACE_SEGMENT_MAX) {
        box.appendChild(this._line(t('第 {i} 段相距 {d} 格，超过单段上限 {max} 格。', { i, d: dist, max: RACE_SEGMENT_MAX }), 'color:#e89a8a;'));
      }
    }

    // 可用标桩
    box.appendChild(this._line(t('附近标桩（按距离排序）'), 'color:#cfe6df;'));
    const used = new Set(draft.points.map((p) => `${p.x},${p.y},${p.z}`));
    const avail = posts.filter((p) => !used.has(`${p.x},${p.y},${p.z}`));
    if (!avail.length) {
      box.appendChild(this._line(t('附近没有可用的御风标桩。'), 'color:#8ea7a2;'));
    } else {
      const availBox = document.createElement('div');
      availBox.style.cssText = 'max-height:170px;overflow:auto;display:flex;flex-direction:column;gap:4px;border:1px solid #33454a;padding:6px;';
      for (const post of avail) {
        const row = this._row();
        row.appendChild(this._line(t('({x}, {y}, {z}) · {d} 格', { x: post.x, y: post.y, z: post.z, d: post.dist })));
        row.appendChild(this._button('加入', () => {
          if (draft.points.length >= RACE_POINT_MAX) return;
          draft.points.push({ x: post.x, y: post.y, z: post.z });
          this.render();
        }, draft.points.length >= RACE_POINT_MAX));
        availBox.appendChild(row);
      }
      box.appendChild(availBox);
    }

    // 保存 / 取消
    const actions = this._row();
    actions.appendChild(this._button(this._pending ? '保存中…' : '保存赛道', () => this._save(), this._pending));
    const pointsOk = draft.points.length >= RACE_POINT_MIN && draft.points.length <= RACE_POINT_MAX;
    const nameOk = draft.name.trim().length > 0;
    if (!nameOk) actions.appendChild(this._line(t('赛道名不能为空。'), 'color:#e89a8a;'));
    else if (!pointsOk) actions.appendChild(this._line(t('点位数量不合法。'), 'color:#e89a8a;'));
    actions.appendChild(this._button('取消', () => { this.draft = null; this.render(); }));
    box.appendChild(actions);

    this.panel.appendChild(box);
  }

  _save() {
    const draft = this.draft;
    if (!draft || this._pending) return;
    const track = sanitizeTrack({
      id: draft.id,
      name: draft.name,
      dim: this.game.world ? this.game.world.dimension : 'overworld',
      mode: draft.mode,
      revision: Math.max(1, draft.revision),
      points: draft.points,
    });
    if (!track) {
      this.game.chatBox?.add(t('赛道定义不合法：请检查名称、点位数量与间距。'), '#fbb');
      return;
    }
    // 点位必须仍是真实的御风标桩：拆掉的桩不能留在赛道里
    const bad = this.game._raceTrackValidity ? this.game._raceTrackValidity(track) : { ok: true };
    if (!bad.ok) {
      const p = track.points[bad.badIndex];
      this.game.chatBox?.add(t('({x}, {y}, {z}) 上没有御风标桩，先放好再保存。', { x: p.x, y: p.y, z: p.z }), '#fbb');
      return;
    }
    const net = this.game.networkMode ? this.game.net : null;
    if (net && typeof net.sendRaceSave === 'function') {
      if (net.sendRaceSave(track)) { this._pending = true; this.render(); }
      else this.game.chatBox?.add(t('未连接房间，无法保存赛道。'), '#fbb');
      return;
    }
    this.game._saveRaceTrack(track);
    this.draft = null;
    this.render();
  }

  _delete(track) {
    this._confirmDelete = '';
    const net = this.game.networkMode ? this.game.net : null;
    if (net && typeof net.sendRaceDelete === 'function' && net.sendRaceDelete(track.id)) {
      this.render();
      return;
    }
    this.game._removeRaceTrack(track.id);
    this.render();
  }

  _start(track) {
    const ok = this.game._armRaceTrack ? this.game._armRaceTrack(track) : false;
    if (!ok) return;
    this.hide();
  }
}
