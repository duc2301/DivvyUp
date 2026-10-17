/**
 * Một phiên đồng soạn ghi chú — điều phối doc Yjs, kênh realtime và việc lưu.
 * KHÔNG React, KHÔNG gọi Supabase trực tiếp: kênh và hàm lưu được truyền vào
 * (deps), nên test được trọn kịch bản nhiều người bằng kênh giả trong bộ nhớ
 * (collab-session.test.ts). Hook React bọc ngoài: use-note-collab.ts.
 *
 * Luồng:
 * 1. Vào kênh → hỏi trạng thái (sync-request). MỘT người đã có doc trả phần mình
 *    thiếu (sync-response) kèm mốc lưu gần nhất — trả lệch ngẫu nhiên vài trăm
 *    ms, thấy người khác trả rồi thì thôi (khỏi N người cùng gửi cả doc). Không
 *    ai trả lời (phòng trống, kênh lỗi) → GIEO từ dòng DB mới nhất, tất định
 *    (buildSeedUpdate) để hai người cùng gieo không nhân đôi chữ.
 * 2. Gõ → thao tác Yjs → gom 150 ms rồi phát cho cả phòng; đánh dấu cần lưu.
 * 3. Tự lưu (dừng gõ 1,5 s, chậm nhất 5 s) với khoá lạc quan updated_at; lưu
 *    xong phát mốc "saved" (updated_at + snapshot) để mọi người cùng nhịp.
 * 4. Lưu bị trễ nhịp: bản trong DB là của người cùng phòng (mốc đã biết) → nhận
 *    mốc, lưu lại; là bản ghi đè từ NGOÀI phòng (app cũ chưa nhận OTA) → GỘP
 *    phần họ sửa vào doc (mergeExternalEdit), lấy DB làm trọng tài: chỉ áp và
 *    phát phần gộp khi lưu bản gộp thành công — hai máy cùng phát hiện thì chỉ
 *    một máy gộp, không nhân đôi.
 * 5. Đóng màn (release): phát nốt, lưu nốt; còn lỗi thì phiên chạy ngầm thử lại
 *    tới khi sạch rồi mới tự dừng — đóng màn đúng lúc mất mạng không mất chữ.
 */

import * as Y from 'yjs';

import type { SaveNoteResult, StoredNoteContent } from '../data/notes.ts';
import type { NoteContent } from './collab.ts';
import {
  absoluteFrom,
  BODY_FIELD,
  buildSeedUpdate,
  createNoteDoc,
  cursorSlot,
  encodeSnapshotOf,
  mergeExternalEdit,
  readContent,
  relativeAt,
  setText,
  TITLE_FIELD,
} from './collab.ts';
import type {
  ChannelStatus,
  CursorState,
  NoteChannel,
  NoteCollabEvent,
  PresencePeer,
  SaveMark,
} from './collab-protocol.ts';
import { NOTE_BODY_MAX, NOTE_TITLE_MAX, sameInstant } from './note-rules.ts';
import { decodeBase64 } from './collab.ts';

/** Chờ người trong phòng trả lời trước khi tự gieo từ DB. */
export const SYNC_WAIT_MS = 700;
/** Người trả lời sync-request chờ ngẫu nhiên tới mức này — ai trả trước thì người khác thôi. */
export const SYNC_REPLY_JITTER_MS = 250;
/** Kênh mãi không vào được (chưa chạy migration, mất mạng) → vẫn cho sửa một mình. */
export const CONNECT_GIVE_UP_MS = 4000;
export const BROADCAST_BATCH_MS = 150;
export const CURSOR_THROTTLE_MS = 300;
export const SAVE_IDLE_MS = 1500;
export const SAVE_MAX_MS = 5000;
export const SAVE_RETRY_MS = 5000;
/** Gửi hỏng → đồng bộ lại sau nhịp này (gộp nhiều lần hỏng liền nhau). */
export const RESYNC_DELAY_MS = 1000;
/** flush thử lưu tối đa ngần này lượt (trễ nhịp do người khác lưu thì lượt sau sẽ qua). */
export const FLUSH_ATTEMPTS = 4;
/** Đóng màn mà chưa lưu được: phiên chạy ngầm thử lại tối đa ngần này rồi mới bỏ. */
export const RELEASE_GIVE_UP_MS = 120_000;
/**
 * Đang gõ thì giữ thao tác của người khác lại một nhịp rồi mới áp: bộ gõ tiếng
 * Việt (Telex/VNI) đang ghép dấu mà chữ ô nhập bị thay giữa chừng là vỡ dấu.
 * Bộ gõ giữ cụm đang ghép qua các nhịp dừng ngắn, nên giữ cả giây; đổi lại chữ
 * người khác hiện chậm tối đa ~1 s, và CHỈ khi mình đang gõ.
 */
export const REMOTE_HOLD_MS = 1000;
/** Hàng đợi thao tác giữ lại khi đang gõ — quá mức thì áp luôn (chặn gói ồ ạt làm phình bộ nhớ). */
export const MAX_HELD_REMOTE = 200;
/** Lệch giờ tối đa chấp nhận cho mốc lưu người khác gửi (mốc ở tương lai xa = gói giả). */
const MARK_FUTURE_SKEW_MS = 10 * 60 * 1000;
/** Số mốc lưu của người khác chờ đủ thao tác — quá thì bỏ mốc cũ nhất. */
const MAX_PENDING_MARKS = 20;

export interface OpenChannelOptions {
  readonly tripId: string;
  readonly noteId: string;
  readonly sessionKey: string;
  readonly memberId: string;
  readonly onEvent: (event: NoteCollabEvent) => void;
  readonly onPeers: (peers: readonly PresencePeer[]) => void;
  readonly onStatus: (status: ChannelStatus, message?: string) => void;
  readonly onSendFailed: () => void;
}

export interface SessionDeps {
  readonly openChannel: (options: OpenChannelOptions) => NoteChannel;
  readonly saveContent: (
    noteId: string,
    content: NoteContent,
    expectedUpdatedAt: string,
  ) => Promise<SaveNoteResult>;
  readonly loadContent: (noteId: string) => Promise<StoredNoteContent | null>;
  /** Lỗi "không tìm thấy / không quyền" (ghi chú đã xoá, bị gỡ khỏi chuyến) — khác lỗi mạng. */
  readonly isGoneError: (error: unknown) => boolean;
  readonly describeError: (error: unknown) => string;
  readonly setTimer: (callback: () => void, ms: number) => unknown;
  readonly clearTimer: (handle: unknown) => void;
  readonly now: () => number;
  /** [0, 1) — độ lệch khi trả lời sync-request. */
  readonly random: () => number;
}

export interface SessionParams {
  readonly tripId: string;
  readonly noteId: string;
  readonly memberId: string;
  readonly sessionKey: string;
  /** Bản đã tải lúc mở danh sách — hiện ngay trong lúc đang kết nối. */
  readonly initial: StoredNoteContent;
}

export type ConnectionState = 'connecting' | 'live' | 'solo';
export type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

export interface PeerCursor {
  readonly key: string;
  readonly memberId: string;
  readonly slot: number;
  /** Vị trí trong NỘI DUNG (chỉ số UTF-16); null = người đó không đặt con trỏ ở nội dung. */
  readonly anchor: number | null;
  readonly head: number | null;
}

export interface SessionSnapshot {
  readonly title: string;
  readonly body: string;
  /** false trong lúc chưa có doc (đang hỏi phòng / đang gieo) — ô nhập khoá. */
  readonly ready: boolean;
  readonly connection: ConnectionState;
  readonly saveState: SaveState;
  readonly saveError: string | null;
  /** Người khác đang mở ghi chú (mỗi phiên một dòng, có thể trùng người). */
  readonly peers: readonly PresencePeer[];
  readonly cursors: readonly PeerCursor[];
  /**
   * Con trỏ CỦA MÌNH trong nội dung sau khi người khác chèn/xoá phía trước —
   * ô nhập dùng để giữ con trỏ đúng chữ. null = chưa đặt con trỏ.
   */
  readonly ownSelection: { readonly anchor: number; readonly head: number } | null;
  /**
   * Tăng mỗi lần chữ đổi do NGƯỜI KHÁC. Ô nhập đặt lại con trỏ theo số này chứ
   * không theo ownSelection: người khác gõ PHÍA SAU con trỏ thì vị trí đúng
   * không đổi, nhưng iOS vẫn tự dời con trỏ (giữ theo khoảng cách tới cuối chữ).
   */
  readonly remoteRevision: number;
  /** Thông báo một lần (ví dụ đã gộp bản lưu từ app cũ). */
  readonly notice: string | null;
  /**
   * Ghi chú đã bị xoá / mình không còn quyền — ô nhập khoá, màn hình hiện lý do
   * (không tự đóng: người dùng còn chép lại được chữ chưa lưu).
   */
  readonly gone: boolean;
}

export const MERGED_NOTICE =
  'Có người vừa sửa ghi chú này từ bản app cũ — phần họ sửa đã được gộp vào, không mất chữ của ai.';
export const UNMERGED_NOTICE =
  'Có người vừa lưu ghi chú này từ bản app cũ nhưng không gộp tự động được. Nội dung bạn đang thấy được giữ và lưu lại; phần họ vừa sửa có thể cần nhập lại.';
export const GONE_MESSAGE =
  'Ghi chú đã bị xoá, hoặc bạn không còn trong chuyến đi. Phần chưa lưu vẫn hiện trên màn hình — chép lại nếu cần.';
const LIMIT_MESSAGE = `Ghi chú vượt giới hạn (tiêu đề ${NOTE_TITLE_MAX}, nội dung ${NOTE_BODY_MAX} ký tự) — rút ngắn để tiếp tục lưu. Chữ vẫn còn nguyên.`;
const STALE_LOAD_MESSAGE = 'Chưa tải được bản mới nhất — đang sửa trên bản đã tải lúc mở danh sách.';

/** Update rỗng của Yjs mã hoá thành [0, 0]. */
function isEmptyUpdate(update: Uint8Array): boolean {
  return update.length <= 2;
}

/** Kiểu delete set của Yjs (không được export riêng). */
type DeleteSet = Y.Snapshot['ds'];

/** Mọi khoảng xoá trong `inner` đều nằm trong `outer`. Ghi chú ≤ 10.000 ký tự nên duyệt từng clock là đủ nhanh. */
function containsDeletes(outer: DeleteSet, inner: DeleteSet): boolean {
  for (const [client, ranges] of inner.clients) {
    for (const range of ranges) {
      for (let clock = range.clock; clock < range.clock + range.len; clock += 1) {
        if (!Y.isDeleted(outer, { client, clock } as Y.ID)) return false;
      }
    }
  }
  return true;
}

function later(a: string, b: string): boolean {
  return Date.parse(a) > Date.parse(b);
}

interface RawCursor {
  readonly memberId: string;
  readonly anchor: string | null;
  readonly head: string | null;
}

export class NoteCollabSession {
  private readonly params: SessionParams;
  private readonly deps: SessionDeps;
  private readonly doc: Y.Doc;
  private channel: NoteChannel | null = null;
  private listeners = new Set<() => void>();
  private snapshot: SessionSnapshot;

  private hasState = false;
  private stopped = false;
  private released = false;
  private expectedUpdatedAt: string;
  private lastSave: SaveMark | null = null;
  /** updated_at của mọi lần lưu TRONG phòng (của mình và người khác). */
  private readonly knownSaves = new Set<string>();

  private pendingUpdates: Uint8Array[] = [];
  private broadcastTimer: unknown = null;
  private seedTimer: unknown = null;
  private giveUpTimer: unknown = null;
  private saveTimer: unknown = null;
  private cursorTimer: unknown = null;
  private holdTimer: unknown = null;
  private resyncTimer: unknown = null;
  private releaseTimer: unknown = null;
  private readonly replyTimers = new Map<string, unknown>();
  private dirtySince: number | null = null;
  private saving: Promise<void> | null = null;
  private overLimit = false;

  private peers: readonly PresencePeer[] = [];
  private readonly rawCursors = new Map<string, RawCursor>();
  private selection: { anchor: number; head: number } | null = null;
  /** Vị trí tương đối của con trỏ mình — bám chữ khi người khác sửa phía trước. */
  private selectionRelative: { anchor: string; head: string } | null = null;
  private remoteHoldUntil = 0;
  private heldRemote: Uint8Array[] = [];
  /** Mốc lưu của người khác chưa nhận được làm gốc gộp (doc chưa đủ thao tác). */
  private pendingMarks: SaveMark[] = [];

  constructor(params: SessionParams, deps: SessionDeps) {
    this.params = params;
    this.deps = deps;
    this.doc = createNoteDoc();
    this.expectedUpdatedAt = params.initial.updatedAt;
    this.snapshot = {
      title: params.initial.title,
      body: params.initial.body,
      ready: false,
      connection: 'connecting',
      saveState: 'idle',
      saveError: null,
      peers: [],
      cursors: [],
      ownSelection: null,
      remoteRevision: 0,
      notice: null,
      gone: false,
    };
    this.doc.on('update', this.onDocUpdate);
  }

  // --- API cho hook (useSyncExternalStore) ----------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): SessionSnapshot => this.snapshot;

  start(): void {
    this.channel = this.deps.openChannel({
      tripId: this.params.tripId,
      noteId: this.params.noteId,
      sessionKey: this.params.sessionKey,
      memberId: this.params.memberId,
      onEvent: (event) => this.onEvent(event),
      onPeers: (peers) => this.onPeers(peers),
      onStatus: (status) => this.onStatus(status),
      onSendFailed: () => this.scheduleResync(),
    });
    // Kênh không lên được (chưa chạy migration, mất mạng): vẫn cho sửa một mình
    // và tự lưu như thường — chỉ không thấy người khác.
    this.giveUpTimer = this.deps.setTimer(() => {
      this.giveUpTimer = null;
      if (!this.hasState) this.seed('solo');
    }, CONNECT_GIVE_UP_MS);
  }

  /** Không còn gì chưa lưu (đã lưu xong mọi chữ đã gõ). */
  isClean(): boolean {
    return this.dirtySince === null && this.saving === null;
  }

  /**
   * Phát nốt phần chưa phát, lưu nốt phần chưa lưu — thử tới FLUSH_ATTEMPTS
   * lượt (trễ nhịp vì người cùng phòng vừa lưu thì lượt sau qua). Trả về true
   * nếu đã sạch. Không ném lỗi: lỗi nằm ở snapshot (saveState/saveError).
   */
  async flush(): Promise<boolean> {
    this.flushBroadcast();
    for (let attempt = 0; attempt < FLUSH_ATTEMPTS; attempt += 1) {
      if (this.saveTimer !== null) {
        this.deps.clearTimer(this.saveTimer);
        this.saveTimer = null;
      }
      if (this.saving) await this.saving;
      if (this.dirtySince === null || this.stopped || this.snapshot.gone || this.overLimit) break;
      await this.saveOnceGuarded();
    }
    return this.isClean();
  }

  /**
   * Màn hình đóng. Sạch thì dừng ngay; còn chưa lưu được (mất mạng…) thì phiên
   * chạy ngầm, các lượt thử lại tự lưu tiếp, sạch thì tự dừng — tối đa
   * RELEASE_GIVE_UP_MS. Không còn màn hình để báo lỗi, nên không được dừng sớm.
   */
  release(): void {
    if (this.released || this.stopped) return;
    this.released = true;
    this.listeners.clear();
    void this.flush().then((clean) => {
      if (clean || this.snapshot.gone || this.overLimit) {
        this.stop();
        return;
      }
      this.scheduleSave(0);
      this.releaseTimer = this.deps.setTimer(() => this.stop(), RELEASE_GIVE_UP_MS);
    });
  }

  stop(): void {
    if (this.stopped) return;
    this.flushBroadcast();
    this.stopped = true;
    for (const timer of [
      this.broadcastTimer,
      this.seedTimer,
      this.giveUpTimer,
      this.saveTimer,
      this.cursorTimer,
      this.holdTimer,
      this.resyncTimer,
      this.releaseTimer,
      ...this.replyTimers.values(),
    ]) {
      if (timer !== null) this.deps.clearTimer(timer);
    }
    this.replyTimers.clear();
    this.channel?.close();
    this.channel = null;
    this.doc.off('update', this.onDocUpdate);
    this.doc.destroy();
    this.listeners.clear();
  }

  editTitle(next: string, caret?: number): void {
    this.edit(TITLE_FIELD, next, caret);
  }

  editBody(next: string, caret?: number): void {
    this.edit(BODY_FIELD, next, caret);
    if (caret !== undefined) this.setBodySelection(caret, caret);
  }

  /** Con trỏ của mình trong nội dung (null = rời ô nội dung). */
  setBodySelection(anchor: number | null, head?: number): void {
    this.selection = anchor === null ? null : { anchor, head: head ?? anchor };
    this.selectionRelative =
      this.selection && this.hasState
        ? {
            anchor: relativeAt(this.doc, BODY_FIELD, this.selection.anchor),
            head: relativeAt(this.doc, BODY_FIELD, this.selection.head),
          }
        : null;
    if (this.cursorTimer !== null || this.stopped) return;
    this.cursorTimer = this.deps.setTimer(() => {
      this.cursorTimer = null;
      this.sendCursor();
    }, CURSOR_THROTTLE_MS);
  }

  dismissNotice(): void {
    this.update({ notice: null });
  }

  // --- Nội bộ: trạng thái & doc ----------------------------------------------

  private update(patch: Partial<SessionSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  private edit(field: string, next: string, caret?: number): void {
    if (!this.hasState || this.stopped || this.snapshot.gone) return;
    this.remoteHoldUntil = this.deps.now() + REMOTE_HOLD_MS;
    setText(this.doc, field, next, caret, 'local');
  }

  private readonly onDocUpdate = (update: Uint8Array, origin: unknown): void => {
    if (this.stopped) return;
    if (origin === 'local' || origin === 'merge') {
      this.pendingUpdates.push(update);
      if (this.broadcastTimer === null) {
        this.broadcastTimer = this.deps.setTimer(() => this.flushBroadcast(), BROADCAST_BATCH_MS);
      }
      this.markDirty();
    }
    const content = readContent(this.doc);
    if (origin !== 'local') this.adoptPendingMarks();
    let ownSelection = this.snapshot.ownSelection;
    if (origin !== 'local' && this.selectionRelative) {
      const anchor = absoluteFrom(this.doc, BODY_FIELD, this.selectionRelative.anchor);
      const head = absoluteFrom(this.doc, BODY_FIELD, this.selectionRelative.head);
      if (anchor !== null && head !== null) {
        this.selection = { anchor, head };
        ownSelection = { anchor, head };
      }
    }
    this.update({
      title: content.title,
      body: content.body,
      cursors: this.resolveCursors(),
      ownSelection,
      remoteRevision:
        origin === 'local' ? this.snapshot.remoteRevision : this.snapshot.remoteRevision + 1,
    });
  };

  // --- Nội bộ: kênh ----------------------------------------------------------

  private flushBroadcast(): void {
    if (this.broadcastTimer !== null) {
      this.deps.clearTimer(this.broadcastTimer);
      this.broadcastTimer = null;
    }
    if (this.pendingUpdates.length === 0 || this.stopped) return;
    const update = Y.mergeUpdates(this.pendingUpdates);
    this.pendingUpdates = [];
    this.channel?.send({ type: 'update', update });
  }

  private sendSyncRequest(): void {
    this.channel?.send({
      type: 'sync-request',
      from: this.params.sessionKey,
      stateVector: Y.encodeStateVector(this.doc),
    });
  }

  /** Gửi hỏng (mất gói, quá hạn mức): đồng bộ lại — người khác trả phần mình thiếu và ngược lại. */
  private scheduleResync(): void {
    if (this.stopped || this.resyncTimer !== null) return;
    this.resyncTimer = this.deps.setTimer(() => {
      this.resyncTimer = null;
      if (this.hasState) this.sendSyncRequest();
    }, RESYNC_DELAY_MS);
  }

  private onStatus(status: ChannelStatus): void {
    if (this.stopped) return;
    if (status === 'live') {
      this.update({ connection: 'live' });
      // Vào (hoặc vào lại sau mất mạng): hỏi phần mình thiếu.
      this.sendSyncRequest();
      if (!this.hasState && this.seedTimer === null) {
        this.seedTimer = this.deps.setTimer(() => {
          this.seedTimer = null;
          if (!this.hasState) this.seed('live');
        }, SYNC_WAIT_MS);
      }
    } else if (status === 'error' && this.hasState) {
      this.update({ connection: 'solo' });
    }
  }

  private onPeers(peers: readonly PresencePeer[]): void {
    this.peers = peers;
    const keys = new Set(peers.map((peer) => peer.key));
    for (const key of [...this.rawCursors.keys()]) {
      if (!keys.has(key)) this.rawCursors.delete(key);
    }
    this.update({ peers, cursors: this.resolveCursors() });
    // Người mới vào: cho họ thấy con trỏ của mình ngay.
    if (this.selection) this.sendCursor();
  }

  private onEvent(event: NoteCollabEvent): void {
    if (this.stopped) return;
    switch (event.type) {
      case 'update':
        this.applyRemote(event.update);
        break;
      case 'sync-request':
        this.scheduleSyncReply(event.from, event.stateVector);
        break;
      case 'sync-response': {
        // Có người đã trả lời người hỏi này — mình thôi, khỏi gửi trùng cả doc.
        const pending = this.replyTimers.get(event.to);
        if (pending !== undefined) {
          this.deps.clearTimer(pending);
          this.replyTimers.delete(event.to);
        }
        if (event.to !== this.params.sessionKey) break;
        // Gói đồng bộ rác (ai trong phòng cũng gửi được): không coi là đã có
        // trạng thái — chờ người khác trả lời hoặc tự gieo.
        if (!this.applyRemote(event.update, true)) break;
        if (event.lastSave) this.adoptPeerMark(event.lastSave);
        // Phần người trả lời còn thiếu (mình gõ lúc mất mạng chẳng hạn).
        const missing = Y.encodeStateAsUpdate(this.doc, event.stateVector);
        if (!isEmptyUpdate(missing)) this.channel?.send({ type: 'update', update: missing });
        this.becomeReady('live');
        break;
      }
      case 'cursor': {
        // Chỉ nhận con trỏ của phiên đang có trong presence VÀ khai đúng memberId
        // của phiên đó — khỏi giả danh người khác hay ghi đè con trỏ của họ, và
        // khỏi phình bộ nhớ theo khoá tuỳ ý. (Người mới vào gửi lại con trỏ khi
        // thấy danh sách người trong phòng đổi.)
        const peer = this.peers.find((item) => item.key === event.cursor.from);
        if (!peer || peer.memberId !== event.cursor.memberId) break;
        this.rawCursors.set(event.cursor.from, {
          memberId: event.cursor.memberId,
          anchor: event.cursor.anchor,
          head: event.cursor.head,
        });
        this.update({ cursors: this.resolveCursors() });
        break;
      }
      case 'saved':
        this.adoptPeerMark(event.mark);
        break;
    }
  }

  /**
   * Mốc lưu do NGƯỜI KHÁC gửi — chỉ là GỢI Ý, dữ liệu không đáng tin (một thành
   * viên có thể gửi mốc giả). Không bao giờ dùng làm khoá lưu (expectedUpdatedAt
   * chỉ lấy từ giá trị DB trả về): mốc rác thì cả phòng không lưu được. Chỉ nhận
   * làm gốc gộp khi snapshot hợp lệ: không trỏ tới thao tác mình chưa có, và
   * không lùi so với gốc hiện tại (snapshot rỗng làm gộp nhân đôi chữ).
   */
  private adoptPeerMark(mark: SaveMark): void {
    const at = Date.parse(mark.updatedAt);
    if (!Number.isFinite(at) || at > Date.now() + MARK_FUTURE_SKEW_MS) return;
    // "Lần lưu này là của người trong phòng" — chỉ dùng để phân loại khi lưu bị
    // trễ nhịp (bản trong DB có phải của phòng không). Mốc giả ở đây chỉ có thể
    // khiến một bản lưu từ app cũ bị coi là "của phòng" rồi bị lưu đè — đúng
    // ngữ nghĩa "người lưu sau thắng" trước khi có đồng soạn, không mất gì hơn.
    this.knownSaves.add(mark.updatedAt);
    this.pendingMarks.push(mark);
    this.adoptPendingMarks();
  }

  /**
   * Nhận mốc chờ làm GỐC GỘP khi snapshot đã hợp lệ. Mốc thường tới TRƯỚC thao
   * tác Yjs của nó (thao tác được gom 150 ms) — chờ tới khi doc đủ thao tác thay
   * vì bỏ. Mốc lùi so với gốc hiện tại thì bỏ hẳn.
   */
  private adoptPendingMarks(): void {
    if (this.pendingMarks.length === 0) return;
    const waiting: SaveMark[] = [];
    for (const mark of this.pendingMarks) {
      const verdict = this.checkBase(mark.snapshot);
      if (verdict === 'wait') {
        waiting.push(mark);
      } else if (verdict === 'ok' && (!this.lastSave || !later(this.lastSave.updatedAt, mark.updatedAt))) {
        this.lastSave = mark;
      }
    }
    this.pendingMarks = waiting.slice(-MAX_PENDING_MARKS);
  }

  /**
   * ok: dùng được làm gốc gộp. wait: trỏ tới thao tác mình chưa có (chờ). bad:
   * hỏng, hoặc LÙI so với gốc hiện tại (snapshot rỗng làm gộp chèn lại cả ghi chú).
   */
  private checkBase(snapshot: string): 'ok' | 'wait' | 'bad' {
    let candidate: Y.Snapshot;
    try {
      candidate = Y.decodeSnapshot(decodeBase64(snapshot));
    } catch {
      return 'bad';
    }
    if (this.lastSave) {
      try {
        const current = Y.decodeSnapshot(decodeBase64(this.lastSave.snapshot));
        for (const [client, clock] of current.sv) {
          if ((candidate.sv.get(client) ?? 0) < clock) return 'bad';
        }
        // Phần đã xoá cũng không được LÙI: gốc hiện tại xoá gì thì gốc mới
        // phải cũng xoá cái đó.
        if (!containsDeletes(candidate.ds, current.ds)) return 'bad';
      } catch {
        // Gốc hiện tại hỏng (không xảy ra với gốc tự tạo) — bỏ qua phép so.
      }
    }
    const docState = Y.decodeStateVector(Y.encodeStateVector(this.doc));
    for (const [client, clock] of candidate.sv) {
      if (clock > (docState.get(client) ?? 0)) return 'wait';
    }
    // Xoá trong Yjs không tăng clock — chỉ so state vector thì một snapshot
    // "đủ thao tác nhưng đánh dấu xoá hết" vẫn lọt, và gộp từ gốc rỗng đó sẽ
    // chèn lại cả ghi chú. Mọi khoảng xoá của snapshot phải là phần doc thật sự
    // đã xoá.
    const docDeletes = Y.createDeleteSetFromStructStore(this.doc.store);
    if (!containsDeletes(docDeletes, candidate.ds)) return 'bad';
    return 'ok';
  }

  private scheduleSyncReply(from: string, stateVector: Uint8Array): void {
    if (!this.hasState || this.replyTimers.has(from)) return;
    const delay = Math.floor(this.deps.random() * SYNC_REPLY_JITTER_MS);
    this.replyTimers.set(
      from,
      this.deps.setTimer(() => {
        this.replyTimers.delete(from);
        if (this.stopped || !this.hasState) return;
        let update: Uint8Array;
        try {
          update = Y.encodeStateAsUpdate(this.doc, stateVector);
        } catch {
          // State vector rác từ người hỏi — không trả lời.
          return;
        }
        this.channel?.send({
          type: 'sync-response',
          from: this.params.sessionKey,
          to: from,
          update,
          stateVector: Y.encodeStateVector(this.doc),
          lastSave: this.lastSave,
        });
      }, delay),
    );
  }

  /** @param immediate bỏ qua việc giữ khi đang gõ (gói đồng bộ lúc vào phòng). */
  /** @returns false nếu gói hỏng (đã bỏ). */
  private applyRemote(update: Uint8Array, immediate = false): boolean {
    const wait = this.remoteHoldUntil - this.deps.now();
    if (!immediate && wait > 0 && this.heldRemote.length < MAX_HELD_REMOTE) {
      this.heldRemote.push(update);
      if (this.holdTimer === null) {
        this.holdTimer = this.deps.setTimer(() => {
          this.holdTimer = null;
          const held = this.heldRemote;
          this.heldRemote = [];
          for (const item of held) this.applyRemote(item);
        }, wait);
      }
      return true;
    }
    try {
      Y.applyUpdate(this.doc, update, 'remote');
      return true;
    } catch {
      // Gói rác từ một thành viên — bỏ, không làm hỏng doc của mình. Thao tác
      // thật bị thiếu (nếu có) sẽ được bù ở lần đồng bộ lại kế tiếp.
      this.scheduleResync();
      return false;
    }
  }

  /** Mốc DB xác nhận (lần lưu của chính mình, dòng vừa gieo) — được dùng làm khoá lưu. */
  private adoptSave(mark: SaveMark): void {
    this.knownSaves.add(mark.updatedAt);
    if (!this.lastSave || !later(this.lastSave.updatedAt, mark.updatedAt)) this.lastSave = mark;
    if (!later(this.expectedUpdatedAt, mark.updatedAt)) this.expectedUpdatedAt = mark.updatedAt;
  }

  private becomeReady(connection: ConnectionState): void {
    if (this.seedTimer !== null) {
      this.deps.clearTimer(this.seedTimer);
      this.seedTimer = null;
    }
    if (this.giveUpTimer !== null) {
      this.deps.clearTimer(this.giveUpTimer);
      this.giveUpTimer = null;
    }
    if (this.hasState) return;
    this.hasState = true;
    const content = readContent(this.doc);
    this.update({ ready: true, connection, title: content.title, body: content.body });
  }

  // --- Nội bộ: gieo ----------------------------------------------------------

  private seed(connection: ConnectionState): void {
    this.seedFromDb(connection).catch((caught: unknown) => {
      // Gieo hỏng (hiếm — doc lỗi): nói ra, đừng để ô nhập khoá mãi im lặng.
      this.update({ saveState: 'error', saveError: this.deps.describeError(caught) });
    });
  }

  private async seedFromDb(connection: ConnectionState): Promise<void> {
    let row: StoredNoteContent | null;
    let loadFailed = false;
    try {
      row = await this.deps.loadContent(this.params.noteId);
    } catch (caught) {
      if (this.deps.isGoneError(caught)) {
        row = null;
      } else {
        // Không đọc được DB (mạng): gieo từ bản đã tải lúc mở — vẫn sửa được,
        // lần lưu sẽ phát hiện nếu bản đó đã cũ. Nói rõ cho người dùng biết.
        row = this.params.initial;
        loadFailed = true;
      }
    }
    if (this.stopped || this.hasState) return;
    if (!row) {
      this.update({ gone: true, saveState: 'error', saveError: GONE_MESSAGE });
      return;
    }
    Y.applyUpdate(this.doc, buildSeedUpdate(this.params.noteId, row), 'seed');
    this.adoptSave({ updatedAt: row.updatedAt, snapshot: encodeSnapshotOf(this.doc) });
    this.expectedUpdatedAt = row.updatedAt;
    this.becomeReady(this.snapshot.connection === 'live' ? 'live' : connection);
    if (loadFailed) this.update({ saveState: 'error', saveError: STALE_LOAD_MESSAGE });
  }

  // --- Nội bộ: lưu -----------------------------------------------------------

  private markDirty(): void {
    if (this.dirtySince === null) this.dirtySince = this.deps.now();
    this.update({ saveState: 'pending' });
    this.scheduleSave(SAVE_IDLE_MS);
  }

  private scheduleSave(idleMs: number): void {
    if (this.stopped) return;
    if (this.saveTimer !== null) this.deps.clearTimer(this.saveTimer);
    const waited = this.dirtySince === null ? 0 : this.deps.now() - this.dirtySince;
    const delay = Math.max(0, Math.min(idleMs, SAVE_MAX_MS - waited));
    this.saveTimer = this.deps.setTimer(() => {
      this.saveTimer = null;
      void this.save();
    }, delay);
  }

  private save(): Promise<void> {
    if (this.saving) {
      // Đang lưu dở: lưu lại sau khi xong (nội dung có thể đã đổi tiếp).
      return this.saving.then(() => (this.dirtySince !== null ? this.save() : undefined));
    }
    return this.saveOnceGuarded();
  }

  private saveOnceGuarded(): Promise<void> {
    this.saving = this.saveOnce().finally(() => {
      this.saving = null;
      // Đã đóng màn và nay sạch → xong việc, dừng phiên chạy ngầm.
      if (this.released && this.dirtySince === null && !this.stopped) this.stop();
    });
    return this.saving;
  }

  private async saveOnce(): Promise<void> {
    if (this.stopped || this.snapshot.gone || this.dirtySince === null) return;
    const content = readContent(this.doc);
    if (content.title.length > NOTE_TITLE_MAX || content.body.length > NOTE_BODY_MAX) {
      // Không cắt chữ của ai — chờ rút ngắn rồi lưu tiếp.
      this.overLimit = true;
      this.update({ saveState: 'error', saveError: LIMIT_MESSAGE });
      return;
    }
    this.overLimit = false;
    const snapshot = encodeSnapshotOf(this.doc);
    this.dirtySince = null;
    this.update({ saveState: 'saving' });

    let result: SaveNoteResult;
    try {
      result = await this.deps.saveContent(this.params.noteId, content, this.expectedUpdatedAt);
    } catch (caught) {
      this.onSaveFailed(caught);
      return;
    }
    if (this.stopped) return;

    if (result.kind === 'saved') {
      this.recordSave({ updatedAt: result.updatedAt, snapshot });
      return;
    }

    const current = result.current;
    const fromRoom =
      [...this.knownSaves].some((known) => sameInstant(known, current.updatedAt)) ||
      (current.title === content.title && current.body === content.body);
    if (fromRoom) {
      // Người cùng phòng vừa lưu — doc đã (hoặc sắp) có phần của họ. Nhận mốc, lưu lại.
      this.expectedUpdatedAt = current.updatedAt;
      this.knownSaves.add(current.updatedAt);
      this.dirtySince = this.dirtySince ?? this.deps.now();
      this.scheduleSave(0);
      return;
    }
    await this.mergeExternal(current);
  }

  private recordSave(mark: SaveMark): void {
    this.adoptSave(mark);
    this.expectedUpdatedAt = mark.updatedAt;
    // Phát thao tác TRƯỚC mốc: người nhận cần đủ thao tác để dùng snapshot.
    this.flushBroadcast();
    this.channel?.send({ type: 'saved', mark });
    this.update({
      saveState: this.dirtySince === null ? 'saved' : 'pending',
      saveError: this.overLimit ? LIMIT_MESSAGE : null,
    });
  }

  /**
   * Bản trong DB bị ghi từ ngoài phòng. Dựng doc tại lần lưu gần nhất, áp phần họ
   * sửa, thử LƯU bản gộp trước (DB làm trọng tài) — thành công mới áp vào doc và
   * phát cho phòng. Thua (máy khác đã gộp trước) thì bỏ phần gộp của mình: phần
   * của máy kia sẽ tới qua kênh.
   */
  private async mergeExternal(current: StoredNoteContent): Promise<void> {
    const update = this.lastSave ? mergeExternalEdit(this.doc, this.lastSave.snapshot, current) : null;
    if (!update) {
      // Không dựng được bản cũ (hiếm): GIỮ chữ đang gõ, nhận mốc mới rồi lưu lại
      // — phần của bản app cũ có thể bị đè. Nói đúng điều đó, không hứa "không mất chữ".
      this.expectedUpdatedAt = current.updatedAt;
      this.knownSaves.add(current.updatedAt);
      this.dirtySince = this.dirtySince ?? this.deps.now();
      this.update({ notice: UNMERGED_NOTICE });
      this.scheduleSave(0);
      return;
    }

    const candidate = createNoteDoc();
    Y.applyUpdate(candidate, Y.encodeStateAsUpdate(this.doc));
    Y.applyUpdate(candidate, update);
    const merged = readContent(candidate);
    const snapshot = encodeSnapshotOf(candidate);
    candidate.destroy();

    let result: SaveNoteResult;
    try {
      result = await this.deps.saveContent(this.params.noteId, merged, current.updatedAt);
    } catch (caught) {
      this.onSaveFailed(caught);
      return;
    }
    if (this.stopped) return;
    if (result.kind === 'saved') {
      Y.applyUpdate(this.doc, update, 'merge');
      this.recordSave({ updatedAt: result.updatedAt, snapshot });
      this.update({ notice: MERGED_NOTICE });
      return;
    }
    // Máy khác gộp trước. Chờ phần của họ tới rồi lưu lại theo luồng thường.
    this.dirtySince = this.dirtySince ?? this.deps.now();
    this.scheduleSave(SAVE_IDLE_MS);
  }

  private onSaveFailed(caught: unknown): void {
    if (this.deps.isGoneError(caught)) {
      this.update({ gone: true, saveState: 'error', saveError: GONE_MESSAGE });
      return;
    }
    // Lỗi mạng/máy chủ: chữ vẫn trong doc (và đã phát cho phòng) — thử lại sau.
    this.dirtySince = this.dirtySince ?? this.deps.now();
    this.update({ saveState: 'error', saveError: this.deps.describeError(caught) });
    this.scheduleSave(SAVE_RETRY_MS);
  }

  // --- Nội bộ: con trỏ -------------------------------------------------------

  private sendCursor(): void {
    if (!this.hasState || this.stopped) return;
    const cursor: CursorState = {
      from: this.params.sessionKey,
      memberId: this.params.memberId,
      anchor: this.selection ? relativeAt(this.doc, BODY_FIELD, this.selection.anchor) : null,
      head: this.selection ? relativeAt(this.doc, BODY_FIELD, this.selection.head) : null,
    };
    this.channel?.send({ type: 'cursor', cursor });
  }

  private resolveCursors(): PeerCursor[] {
    const known = new Set(this.peers.map((peer) => peer.key));
    const cursors: PeerCursor[] = [];
    for (const [key, raw] of this.rawCursors) {
      // Chỉ người còn trong phòng (presence) — người đã rời thì con trỏ biến mất.
      if (!known.has(key)) continue;
      const anchor = raw.anchor ? absoluteFrom(this.doc, BODY_FIELD, raw.anchor) : null;
      const head = raw.head ? absoluteFrom(this.doc, BODY_FIELD, raw.head) : null;
      cursors.push({ key, memberId: raw.memberId, slot: cursorSlot(raw.memberId), anchor, head });
    }
    return cursors;
  }
}
