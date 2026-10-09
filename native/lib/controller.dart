import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'game.dart';
import 'peerjs.dart';
import 'room.dart';
import 'transport.dart';
import 'browser.dart';

GameState? _cpuReply(GameState state) {
  final move = choose(state);
  return move == null ? null : play(state, move)?.state;
}

class GameController extends ChangeNotifier {
  GameController({RoomPeer Function()? peerFactory})
    : peerFactory = peerFactory ?? (() => NativePeer());
  final RoomPeer Function() peerFactory;
  GameState state = GameState();
  OnlineRoom? room;
  bool online = false, thinking = false, _disposed = false;
  String roomStatus = '';
  Timer? _cpuTimer;
  int _epoch = 0;
  final List<GameState> _undo = [];
  SharedPreferences? _preferences;
  bool get spectator => online && (room?.spectator ?? false);
  bool get canInteract =>
      !_disposed &&
      state.result == null &&
      !thinking &&
      (online ? room?.canMove == true : state.turn == 1);
  bool get canUndo => !online && !thinking && _undo.isNotEmpty;
  GameState? _reachState;
  List<int> _reachPlayers = const [];
  List<int> get reachPlayers {
    if (!identical(_reachState, state)) {
      _reachState = state;
      _reachPlayers = playersInReach(state);
    }
    return _reachPlayers;
  }

  void changed() {
    if (!_disposed) {
      if (online && room != null && room!.target.isNotEmpty) {
        setInvitation(room!.target, room!.spectator);
      }
      notifyListeners();
    }
  }

  Future<void> load() async {
    try {
      _preferences = await SharedPreferences.getInstance();
      final text = _preferences!.getString('high-tension-native-v1');
      final saved = text == null ? null : restore(jsonDecode(text));
      if (saved != null) state = saved;
    } catch (_) {
      /* Start a new game when saved data cannot be restored. */
    }
    if (_disposed) return;
    _schedule();
    changed();
  }

  void _save() {
    if (!online)
      unawaited(
        _preferences?.setString(
              'high-tension-native-v1',
              jsonEncode(state.log.map((m) => m.toJson()).toList()),
            ) ??
            Future.value(false),
      );
  }

  void _schedule() {
    _cpuTimer?.cancel();
    if (!online && state.turn == 2 && state.result == null) {
      final epoch = _epoch;
      _cpuTimer = Timer(const Duration(milliseconds: 600), () async {
        if (_disposed || online || epoch != _epoch) return;
        thinking = true;
        changed();
        final next = await compute(_cpuReply, state);
        if (_disposed || epoch != _epoch || online) return;
        if (next != null) state = next;
        thinking = false;
        _save();
        changed();
      });
    }
  }

  bool move(Move move) {
    if (!canInteract) return false;
    if (online) return room!.move(move);
    final out = play(state, move);
    if (out == null) return false;
    _undo.add(state);
    state = out.state;
    _save();
    _schedule();
    changed();
    return true;
  }

  void undo() {
    if (!canUndo) return;
    _epoch++;
    _cpuTimer?.cancel();
    state = _undo.removeLast();
    thinking = false;
    _save();
    changed();
  }

  Future<void> startCpu() async {
    setInvitation('', false);
    _epoch++;
    _cpuTimer?.cancel();
    thinking = false;
    online = false;
    final old = room;
    room = null;
    await old?.close();
    state = GameState();
    _undo.clear();
    _save();
    changed();
  }

  Future<void> startOnline({Invitation? invitation}) async {
    setInvitation(invitation?.target ?? '', invitation?.spectator ?? false);
    _epoch++;
    _cpuTimer?.cancel();
    thinking = false;
    online = true;
    final old = room;
    room = null;
    await old?.close();
    if (_disposed) return;
    state = GameState();
    _undo.clear();
    roomStatus = '接続を準備しています…';
    final next = OnlineRoom(
      peerFactory: peerFactory,
      onState: (next, steps) {
        if (_disposed) return;
        state = next;
        changed();
      },
      onStatus: (text) {
        roomStatus = text;
        changed();
      },
    );
    room = next;
    changed();
    await next.start(
      target: invitation?.target ?? '',
      spectator: invitation?.spectator ?? false,
    );
  }

  void rematch() {
    if (online) room?.rematch();
  }

  Future<void> retry() async {
    await room?.retry();
  }

  String get turnLabel {
    if (state.result != null)
      return state.result == 0
          ? '引き分け'
          : '${state.result == 1 ? '先攻' : '後攻'}の勝ち';
    if (online) {
      if (room?.ready != true) return '接続待ち';
      if (spectator)
        return room!.playing ? '${state.turn == 1 ? '先攻' : '後攻'}の番' : '接続待ち';
      return room!.role == state.turn ? 'あなたの番' : '相手の番';
    }
    return state.turn == 1 ? 'あなたの番' : 'CPUの番';
  }

  String get hint {
    if (spectator)
      return room?.ready == true && room?.playing == true
          ? '観戦中'
          : '対戦の再接続を待っています';
    if (state.result != null)
      return state.result == 0 ? 'もう一局、どうぞ。' : '3つ、揃いました。';
    if (!canInteract) return online ? '相手の手を待っています' : '考えています…';
    return '空きマスをタップ · コマをドラッグ';
  }

  @override
  void dispose() {
    _disposed = true;
    _epoch++;
    _cpuTimer?.cancel();
    if (room != null) unawaited(room!.close());
    super.dispose();
  }
}
