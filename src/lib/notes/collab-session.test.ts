/**
 * Kịch bản nhiều người cho phiên đồng soạn — kênh realtime giả trong bộ nhớ, DB
 * giả có khoá lạc quan như trip_notes, đồng hồ giả (không chờ thật).
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import * as Y from 'yjs';

import type { SaveNoteResult, StoredNoteContent } from '../data/notes.ts';
import type { NoteContent } from './collab.ts';
import { encodeBase64 } from './collab.ts';
import type { NoteCollabEvent, PresencePeer } from './collab-protocol.ts';
import type { OpenChannelOptions, SessionDeps } from './collab-session.ts';
import { GONE_MESSAGE, MERGED_NOTICE, NoteCollabSession } from './collab-session.ts';
import { NOTE_BODY_MAX } from './note-rules.ts';

class GoneError extends Error {}
class NetworkError extends Error {}

interface Timer {
  readonly id: number;
  readonly at: number;
  readonly callback: () => void;
}

class World {
  time = 0;
  private timers: Timer[] = [];
  private nextTimer = 1;
  private members = new Map<string, OpenChannelOptions>();
  private disconnected = new Set<string>();
  /** Kênh có lên được không (false = chưa chạy migration / mất mạng). */
  channelWorks = true;
  /** Lưu xuống DB ném lỗi mạng. */
  saveFails = false;
  /** Đọc DB ném lỗi mạng. */
  loadFails = false;
  db: { title: string; body: string; version: number; deleted: boolean };
  saves = 0;
  readonly sent: string[] = [];
  /** LCG tất định cho độ lệch trả lời sync. */
  private seed = 42;

  constructor(title: string, body: string) {
    this.db = { title, body, version: 1, deleted: false };
  }

  stamp(version: number): string {
    return new Date(Date.UTC(2026, 9, 17, 0, 0, version)).toISOString();
  }

  row(): StoredNoteContent {
    return { title: this.db.title, body: this.db.body, updatedAt: this.stamp(this.db.version) };
  }

  /** Bản app cũ (không đồng soạn) lưu đè cả ghi chú. */
  externalWrite(content: NoteContent): void {
    this.db = { ...this.db, ...content, version: this.db.version + 1 };
  }

  deps(): SessionDeps {
    return {
      openChannel: (options) => this.open(options),
      saveContent: async (_noteId, content, expected): Promise<SaveNoteResult> => {
        await Promise.resolve();
        if (this.saveFails) throw new NetworkError('mất mạng');
        if (this.db.deleted) throw new GoneError('gone');
        if (expected !== this.stamp(this.db.version)) return { kind: 'stale', current: this.row() };
        this.saves += 1;
        this.db = { ...this.db, ...content, version: this.db.version + 1 };
        return { kind: 'saved', updatedAt: this.stamp(this.db.version) };
      },
      loadContent: async () => {
        await Promise.resolve();
        if (this.loadFails) throw new NetworkError('mất mạng');
        return this.db.deleted ? null : this.row();
      },
      isGoneError: (error) => error instanceof GoneError,
      describeError: (error) => (error instanceof Error ? error.message : String(error)),
      setTimer: (callback, ms) => {
        const timer = { id: this.nextTimer++, at: this.time + ms, callback };
        this.timers.push(timer);
        return timer.id;
      },
      clearTimer: (handle) => {
        this.timers = this.timers.filter((timer) => timer.id !== handle);
      },
      now: () => this.time,
      random: () => {
        this.seed = (this.seed * 1103515245 + 12345) % 2147483648;
        return this.seed / 2147483648;
      },
    };
  }

  private open(options: OpenChannelOptions) {
    const key = options.sessionKey;
    if (this.channelWorks) {
      queueMicrotask(() => {
        this.members.set(key, options);
        options.onStatus('live');
        this.announcePeers();
      });
    } else {
      queueMicrotask(() => options.onStatus('error', 'unauthorized'));
    }
    return {
      send: (event: NoteCollabEvent) => {
        if (!this.members.has(key) || this.disconnected.has(key)) return;
        this.sent.push(event.type);
        this.deliver(key, event);
      },
      close: () => {
        this.members.delete(key);
        this.announcePeers();
      },
    };
  }

  /** Gửi gói tới mọi người khác trong phòng (giả lập máy chủ broadcast). */
  deliver(from: string, event: NoteCollabEvent): void {
    for (const [otherKey, other] of this.members) {
      if (otherKey === from || this.disconnected.has(otherKey)) continue;
      queueMicrotask(() => this.members.get(otherKey) && other.onEvent(event));
    }
  }

  /** Chèn một gói tuỳ ý (như từ một thành viên khác) vào phiên `to`. */
  inject(to: string, event: NoteCollabEvent): void {
    const target = this.members.get(to);
    if (target) queueMicrotask(() => target.onEvent(event));
  }

  disconnect(key: string): void {
    this.disconnected.add(key);
    this.members.get(key)?.onStatus('error', 'mất mạng');
  }

  reconnect(key: string): void {
    this.disconnected.delete(key);
    this.members.get(key)?.onStatus('live');
  }

  private announcePeers(): void {
    for (const [key, member] of this.members) {
      const peers: PresencePeer[] = [...this.members]
        .filter(([other]) => other !== key)
        .map(([other, info]) => ({ key: other, memberId: info.memberId }));
      member.onPeers(peers);
    }
  }

  /** Chạy đồng hồ giả, xả promise giữa các bước. */
  async advance(ms: number): Promise<void> {
    const end = this.time + ms;
    for (;;) {
      await flush();
      const due = this.timers.filter((timer) => timer.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.timers = this.timers.filter((timer) => timer.id !== due.id);
      this.time = Math.max(this.time, due.at);
      due.callback();
    }
    this.time = end;
    await flush();
  }

  session(key: string, memberId: string, initial = this.row()): NoteCollabSession {
    const session = new NoteCollabSession(
      { tripId: 't1', noteId: 'n1', memberId, sessionKey: key, initial },
      this.deps(),
    );
    session.start();
    return session;
  }
}

async function flush(): Promise<void> {
  for (let round = 0; round < 20; round += 1) await new Promise((resolve) => setImmediate(resolve));
}

function text(session: NoteCollabSession): NoteContent {
  const { title, body } = session.getSnapshot();
  return { title, body };
}

describe('NoteCollabSession — đồng bộ & gieo', () => {
  test('hai người mở cùng lúc khi phòng trống → không nhân đôi chữ', async () => {
    const world = new World('Kế hoạch', 'Ngày 1: Đà Lạt');
    const a = world.session('a', 'm-a');
    const b = world.session('b', 'm-b');
    await world.advance(2000);
    assert.ok(a.getSnapshot().ready && b.getSnapshot().ready);
    assert.deepEqual(text(a), { title: 'Kế hoạch', body: 'Ngày 1: Đà Lạt' });
    assert.deepEqual(text(b), text(a));
  });

  test('gõ ở máy này hiện ở máy kia, rồi được lưu xuống DB', async () => {
    const world = new World('T', 'abc');
    const a = world.session('a', 'm-a');
    const b = world.session('b', 'm-b');
    await world.advance(1000);
    a.editBody('abc def', 7);
    await world.advance(300);
    assert.equal(b.getSnapshot().body, 'abc def');
    await world.advance(6000);
    assert.equal(world.db.body, 'abc def');
    assert.equal(a.getSnapshot().saveState, 'saved');
  });

  test('cả hai cùng gõ một lúc → hội tụ, không mất chữ, DB đúng bản cuối', async () => {
    const world = new World('T', 'abc');
    const a = world.session('a', 'm-a');
    const b = world.session('b', 'm-b');
    await world.advance(1000);
    a.editBody('Xabc', 1);
    b.editBody('abcY', 4);
    b.editTitle('Tiêu đề', 7);
    await world.advance(8000);
    assert.deepEqual(text(a), { title: 'Tiêu đề', body: 'XabcY' });
    assert.deepEqual(text(b), text(a));
    assert.deepEqual({ title: world.db.title, body: world.db.body }, text(a));
  });

  test('12 người cùng gõ → mọi máy hội tụ cùng một chữ, DB khớp', async () => {
    const world = new World('T', '');
    const sessions = Array.from({ length: 12 }, (_, index) => world.session(`s${index}`, `m${index}`));
    await world.advance(2000);
    sessions.forEach((session, index) => session.editBody(String.fromCharCode(65 + index), 1));
    await world.advance(20000);
    const body = sessions[0].getSnapshot().body;
    assert.equal(body.length, 12);
    for (const session of sessions) assert.equal(session.getSnapshot().body, body);
    assert.equal(world.db.body, body);
  });

  test('người vào sau nhận chữ CHƯA LƯU từ phòng, không gieo lại từ DB cũ', async () => {
    const world = new World('T', 'abc');
    const a = world.session('a', 'm-a');
    await world.advance(1000);
    a.editBody('abc + chưa lưu', 14);
    await world.advance(200); // chưa tới lúc tự lưu
    assert.equal(world.db.body, 'abc');
    const c = world.session('c', 'm-c');
    await world.advance(800);
    assert.equal(c.getSnapshot().body, 'abc + chưa lưu');
    await world.advance(8000);
    assert.equal(world.db.body, 'abc + chưa lưu', 'không nhân đôi khi lưu');
  });

  test('người vào phòng 3 người → chỉ MỘT người trả lời đồng bộ (không gửi cả doc trùng lặp)', async () => {
    const world = new World('T', 'abc');
    world.session('a', 'm-a');
    world.session('b', 'm-b');
    world.session('c', 'm-c');
    await world.advance(2000);
    const before = world.sent.filter((type) => type === 'sync-response').length;
    world.session('d', 'm-d');
    await world.advance(2000);
    const responses = world.sent.filter((type) => type === 'sync-response').length - before;
    assert.equal(responses, 1);
  });

  test('mất mạng rồi nối lại → hiện "một mình", chữ gõ lúc mất mạng tới được người kia', async () => {
    const world = new World('T', 'abc');
    const a = world.session('a', 'm-a');
    const b = world.session('b', 'm-b');
    await world.advance(1000);
    world.disconnect('a');
    await world.advance(10);
    assert.equal(a.getSnapshot().connection, 'solo');
    world.saveFails = true; // mất mạng thật: lưu cũng hỏng
    a.editBody('abc!', 4);
    await world.advance(3000);
    assert.equal(b.getSnapshot().body, 'abc');
    world.saveFails = false;
    world.reconnect('a');
    await world.advance(8000);
    assert.equal(a.getSnapshot().connection, 'live');
    assert.equal(b.getSnapshot().body, 'abc!');
    assert.equal(world.db.body, 'abc!');
  });

  test('kênh không vào được (chưa chạy migration) → vẫn sửa và tự lưu một mình', async () => {
    const world = new World('T', 'abc');
    world.channelWorks = false;
    const a = world.session('a', 'm-a');
    await world.advance(5000);
    assert.equal(a.getSnapshot().ready, true);
    a.editBody('abcd', 4);
    await world.advance(6000);
    assert.equal(world.db.body, 'abcd');
  });

  test('không đọc được DB lúc mở → vẫn sửa trên bản đã tải, có báo lỗi (không im lặng)', async () => {
    const world = new World('T', 'abc');
    world.channelWorks = false;
    world.loadFails = true;
    const a = world.session('a', 'm-a');
    await world.advance(5000);
    assert.equal(a.getSnapshot().ready, true);
    assert.equal(a.getSnapshot().saveState, 'error');
    assert.ok(a.getSnapshot().saveError);
  });

  test('chưa sẵn sàng thì không nhận gõ (tránh gõ vào doc chưa gieo)', async () => {
    const world = new World('T', 'abc');
    const a = world.session('a', 'm-a');
    a.editBody('xyz', 3);
    await world.advance(2000);
    assert.equal(a.getSnapshot().body, 'abc');
  });
});

describe('NoteCollabSession — lưu & không mất chữ', () => {
  test('flush khi bấm Xong → lưu ngay phần chưa lưu, báo đã sạch', async () => {
    const world = new World('T', 'abc');
    const a = world.session('a', 'm-a');
    await world.advance(1000);
    a.editBody('abcd', 4);
    assert.equal(await a.flush(), true);
    assert.equal(world.db.body, 'abcd');
  });

  test('flush lúc mất mạng → báo CHƯA sạch (màn hình không được đóng)', async () => {
    const world = new World('T', 'abc');
    const a = world.session('a', 'm-a');
    await world.advance(1000);
    world.saveFails = true;
    a.editBody('abcd', 4);
    assert.equal(await a.flush(), false);
    assert.equal(a.getSnapshot().saveState, 'error');
  });

  test('đóng màn (release) lúc mất mạng → phiên chạy ngầm, có mạng lại thì lưu xong', async () => {
    const world = new World('T', 'abc');
    const a = world.session('a', 'm-a');
    await world.advance(1000);
    world.saveFails = true;
    a.editBody('abcd', 4);
    a.release();
    await world.advance(3000);
    assert.equal(world.db.body, 'abc');
    world.saveFails = false;
    await world.advance(10000);
    assert.equal(world.db.body, 'abcd', 'chữ gõ trước khi đóng màn không mất');
  });

  test('đóng màn đúng lúc người cùng phòng vừa lưu (trễ nhịp) → vẫn lưu xong', async () => {
    const world = new World('T', 'abc');
    const a = world.session('a', 'm-a');
    const b = world.session('b', 'm-b');
    await world.advance(1000);
    b.editBody('abcB', 4);
    await world.advance(1600); // b đã lưu
    // A đã có chữ của B: ô nhập của A đang hiện 'abcB'.
    a.editBody('AabcB', 1);
    a.release();
    await world.advance(10000);
    assert.ok(world.db.body.includes('A'), world.db.body);
    assert.ok(world.db.body.includes('B'), world.db.body);
  });

  test('ghi chú bị xoá trong lúc soạn → gone kèm lý do, ô nhập khoá, chữ vẫn hiện', async () => {
    const world = new World('T', 'abc');
    const a = world.session('a', 'm-a');
    await world.advance(1000);
    world.db.deleted = true;
    a.editBody('abcd', 4);
    await world.advance(6000);
    assert.equal(a.getSnapshot().gone, true);
    assert.equal(a.getSnapshot().saveError, GONE_MESSAGE);
    assert.equal(a.getSnapshot().body, 'abcd');
    a.editBody('abcde', 5);
    assert.equal(a.getSnapshot().body, 'abcd', 'đã gone thì không nhận gõ');
  });

  test('ghi chú đã xoá ngay lúc mở → gone, không gieo', async () => {
    const world = new World('T', 'abc');
    world.db.deleted = true;
    const a = world.session('a', 'm-a');
    await world.advance(5000);
    assert.equal(a.getSnapshot().gone, true);
  });

  test('vượt giới hạn độ dài → không lưu, báo lỗi, chữ còn nguyên; rút ngắn thì lưu tiếp', async () => {
    const world = new World('T', '');
    const a = world.session('a', 'm-a');
    await world.advance(1000);
    const long = 'x'.repeat(NOTE_BODY_MAX + 1);
    a.editBody(long, long.length);
    await world.advance(8000);
    assert.equal(world.db.body, '');
    assert.equal(a.getSnapshot().body, long);
    assert.equal(a.getSnapshot().saveState, 'error');
    a.editBody('ngắn', 4);
    await world.advance(8000);
    assert.equal(world.db.body, 'ngắn');
  });
});

describe('NoteCollabSession — bản lưu từ app cũ', () => {
  test('app cũ lưu đè trong lúc đang đồng soạn → gộp, giữ chữ của cả hai bên', async () => {
    const world = new World('Lưu ý', 'Mang áo ấm.');
    const a = world.session('a', 'm-a');
    const b = world.session('b', 'm-b');
    await world.advance(1000);
    world.externalWrite({ title: 'Lưu ý', body: 'Nhớ mang áo ấm.' });
    a.editBody('Mang áo ấm. Đặt phòng.', 22);
    await world.advance(8000);
    const expected = 'Nhớ mang áo ấm. Đặt phòng.';
    assert.equal(a.getSnapshot().body, expected);
    assert.equal(b.getSnapshot().body, expected);
    assert.equal(world.db.body, expected);
    assert.equal(a.getSnapshot().notice, MERGED_NOTICE);
  });

  test('hai máy cùng phát hiện bản ghi đè → chỉ gộp MỘT lần', async () => {
    const world = new World('T', 'abc');
    const a = world.session('a', 'm-a');
    const b = world.session('b', 'm-b');
    await world.advance(1000);
    world.externalWrite({ title: 'T', body: 'abc!' });
    a.editBody('Xabc', 1);
    b.editBody('abcY', 4);
    await world.advance(12000);
    const body = a.getSnapshot().body;
    // '!' (bản ghi đè) và 'Y' cùng chèn sau 'abc': thứ tự do CRDT quyết, nhưng
    // '!' chỉ được có MỘT — gộp hai lần là lỗi.
    assert.equal([...body].filter((char) => char === '!').length, 1, body);
    assert.ok(body === 'Xabc!Y' || body === 'XabcY!', body);
    assert.equal(b.getSnapshot().body, body);
    assert.equal(world.db.body, body);
  });
});

describe('NoteCollabSession — gói tin không đáng tin', () => {
  test('mốc "saved" giả (ngày rác, tương lai xa, snapshot rỗng) → bỏ qua, vẫn lưu bình thường, không nhân đôi', async () => {
    const world = new World('T', 'abc');
    const a = world.session('a', 'm-a');
    await world.advance(1000);
    const empty = encodeBase64(Y.encodeSnapshot(Y.emptySnapshot));
    world.inject('a', { type: 'saved', mark: { updatedAt: 'x', snapshot: 'x' } });
    world.inject('a', { type: 'saved', mark: { updatedAt: '9999-12-31T00:00:00Z', snapshot: empty } });
    world.inject('a', { type: 'saved', mark: { updatedAt: world.stamp(1), snapshot: empty } });
    await world.advance(10);
    world.externalWrite({ title: 'T', body: 'abc!' }); // buộc đi nhánh gộp
    a.editBody('Xabc', 1);
    await world.advance(10000);
    assert.equal(a.getSnapshot().body, 'Xabc!');
    assert.equal(world.db.body, 'Xabc!', 'gộp từ gốc thật, không chèn lại cả ghi chú');
  });

  test('mốc "saved" có snapshot đủ thao tác nhưng ĐÁNH DẤU XOÁ HẾT → bỏ, gộp không nhân đôi', async () => {
    const world = new World('T', 'abc');
    const a = world.session('a', 'm-a');
    const b = world.session('b', 'm-b');
    await world.advance(1000);
    b.editBody('abcd', 4);
    await world.advance(3000); // a đã có đủ thao tác, b đã lưu
    // Kẻ xấu (thành viên trong phòng) có bản sao doc: xoá sạch rồi chụp snapshot —
    // state vector đủ, chỉ khác ở phần đã xoá.
    const copy = new Y.Doc({ gc: false });
    const docOfB = (b as unknown as { doc: Y.Doc }).doc;
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(docOfB));
    copy.transact(() => {
      copy.getText('body').delete(0, copy.getText('body').length);
      copy.getText('title').delete(0, copy.getText('title').length);
    });
    const forged = encodeBase64(Y.encodeSnapshot(Y.snapshot(copy)));
    world.inject('a', { type: 'saved', mark: { updatedAt: new Date().toISOString(), snapshot: forged } });
    await world.advance(10);
    world.externalWrite({ title: 'T', body: 'abcd!' }); // buộc a đi nhánh gộp
    a.editBody('Xabcd', 1);
    await world.advance(10000);
    assert.equal(a.getSnapshot().body, 'Xabcd!');
    assert.equal(world.db.body, 'Xabcd!', 'không chèn lại cả ghi chú từ gốc rỗng');
  });

  test('sync-response rác → người mới KHÔNG coi là đã có trạng thái', async () => {
    const world = new World('T', 'abc');
    const c = world.session('c', 'm-c');
    await world.advance(1); // c đã vào kênh, đang chờ trả lời
    world.inject('c', {
      type: 'sync-response',
      from: 'x',
      to: 'c',
      update: new Uint8Array([255, 9, 9, 9]),
      stateVector: new Uint8Array([0]),
      lastSave: null,
    });
    await world.advance(50);
    assert.equal(c.getSnapshot().ready, false);
    await world.advance(2000); // không ai trả lời thật → tự gieo từ DB
    assert.equal(c.getSnapshot().ready, true);
    assert.equal(c.getSnapshot().body, 'abc');
  });

  test('update rác → bỏ, doc nguyên vẹn', async () => {
    const world = new World('T', 'abc');
    const a = world.session('a', 'm-a');
    await world.advance(1000);
    world.inject('a', { type: 'update', update: new Uint8Array([255, 1, 2, 3, 4, 5]) });
    await world.advance(100);
    assert.equal(a.getSnapshot().body, 'abc');
  });

  test('con trỏ giả danh (memberId không khớp phiên) hoặc từ phiên lạ → bỏ', async () => {
    const world = new World('T', 'abc');
    const a = world.session('a', 'm-a');
    world.session('b', 'm-b');
    await world.advance(1000);
    world.inject('a', { type: 'cursor', cursor: { from: 'b', memberId: 'm-a', anchor: null, head: null } });
    world.inject('a', { type: 'cursor', cursor: { from: 'zzz', memberId: 'm-x', anchor: null, head: null } });
    await world.advance(100);
    assert.deepEqual(a.getSnapshot().cursors, []);
  });
});

describe('NoteCollabSession — con trỏ & bộ gõ', () => {
  test('con trỏ người khác hiện đúng chỗ, bám chữ khi có người gõ phía trước, mất khi họ rời', async () => {
    const world = new World('T', 'Đà Lạt');
    const a = world.session('a', 'm-a');
    const b = world.session('b', 'm-b');
    await world.advance(1000);
    b.setBodySelection(3);
    await world.advance(500);
    assert.deepEqual(
      a.getSnapshot().cursors.map((cursor) => [cursor.memberId, cursor.anchor]),
      [['m-b', 3]],
    );
    a.editBody('Đi Đà Lạt', 3);
    await world.advance(500);
    assert.equal(a.getSnapshot().cursors[0]?.anchor, 6);
    b.stop();
    await world.advance(100);
    assert.deepEqual(a.getSnapshot().cursors, []);
  });

  test('đang gõ thì thao tác người khác được giữ một nhịp rồi mới áp (bộ gõ tiếng Việt)', async () => {
    const world = new World('T', 'abc');
    const a = world.session('a', 'm-a');
    const b = world.session('b', 'm-b');
    await world.advance(1000);
    a.editBody('abcâ', 4);
    b.editBody('Xabc', 1);
    await world.advance(200); // B đã phát, A vẫn đang trong nhịp gõ
    assert.equal(a.getSnapshot().body, 'abcâ');
    await world.advance(1500);
    assert.equal(a.getSnapshot().body, 'Xabcâ');
  });

  test('con trỏ của mình bám chữ khi người khác chèn phía trước', async () => {
    const world = new World('T', 'Đà Lạt');
    const a = world.session('a', 'm-a');
    const b = world.session('b', 'm-b');
    await world.advance(1000);
    a.setBodySelection(6);
    b.editBody('Đi Đà Lạt', 3);
    await world.advance(2000);
    assert.deepEqual(a.getSnapshot().ownSelection, { anchor: 9, head: 9 });
  });

  test('người khác gõ PHÍA SAU con trỏ → báo màn hình đặt lại con trỏ (iOS tự dời theo cuối chữ)', async () => {
    const world = new World('T', 'Đà Lạt');
    const a = world.session('a', 'm-a');
    const b = world.session('b', 'm-b');
    await world.advance(1000);
    a.setBodySelection(2);
    const before = a.getSnapshot().remoteRevision;
    b.editBody('Đà Lạt ơi', 9);
    await world.advance(2000);
    assert.ok(a.getSnapshot().remoteRevision > before);
    assert.deepEqual(a.getSnapshot().ownSelection, { anchor: 2, head: 2 });
  });
});
