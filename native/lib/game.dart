import 'dart:math';

const directions = <(int, int)>[
  (-1, -1),
  (-1, 0),
  (-1, 1),
  (0, -1),
  (0, 1),
  (1, -1),
  (1, 0),
  (1, 1),
];
bool inside(int r, int c) => r >= 0 && r < 5 && c >= 0 && c < 5;
String boardKey(List<int> board) => board.join();

class Move {
  const Move.place(this.i, {this.player}) : type = 'place', dr = 0, dc = 0;
  const Move.flick(this.i, this.dr, this.dc, {this.player}) : type = 'flick';
  final String type;
  final int i, dr, dc;
  final int? player;
  Map<String, dynamic> toJson() => {
    'type': type,
    'i': i,
    if (type == 'flick') ...{'dr': dr, 'dc': dc},
    if (player != null) 'player': player,
  };
  static Move? parse(dynamic value) {
    if (value is! Map || value['i'] is! int) return null;
    final i = value['i'] as int;
    if (i < 0 || i >= 25) return null;
    final player = value['player'];
    if (player != null && (player is! int || (player != 1 && player != 2)))
      return null;
    if (value['type'] == 'place') return Move.place(i, player: player as int?);
    if (value['type'] != 'flick' || value['dr'] is! int || value['dc'] is! int)
      return null;
    final dr = value['dr'] as int, dc = value['dc'] as int;
    if (!directions.contains((dr, dc))) return null;
    return Move.flick(i, dr, dc, player: player as int?);
  }

  Move by(int player) => type == 'place'
      ? Move.place(i, player: player)
      : Move.flick(i, dr, dc, player: player);
}

class Slide {
  Slide(List<int> board, this.from, this.to) : board = List.unmodifiable(board);
  final List<int> board;
  final int from, to;
}

class Preview {
  Preview(List<int> board, List<Slide> steps)
    : board = List.unmodifiable(board),
      steps = List.unmodifiable(steps);
  final List<int> board;
  final List<Slide> steps;
}

class Played {
  const Played(this.state, this.steps);
  final GameState state;
  final List<Slide> steps;
}

class GameState {
  GameState({
    List<int>? board,
    this.turn = 1,
    this.previous,
    this.moves = 0,
    this.result,
    List<Move> log = const [],
  }) : board = List.unmodifiable(board ?? List.filled(25, 0)),
       log = List.unmodifiable(log);
  final List<int> board;
  final int turn, moves;
  final String? previous;
  // null = ongoing, 0 = draw, 1/2 = winner.
  final int? result;
  final List<Move> log;
  Map<String, dynamic> toJson() => {
    'board': board,
    'turn': turn,
    'previous': previous,
    'moves': moves,
    'result': result == 0 ? 'draw' : result,
    'log': log.map((m) => m.toJson()).toList(),
  };
}

bool canPlace(GameState state, int i) {
  if (state.result != null ||
      i < 0 ||
      i >= 25 ||
      state.board[i] != 0 ||
      state.board.where((p) => p == state.turn).length >= 5)
    return false;
  final r = i ~/ 5, c = i % 5;
  return directions.every(
    (d) =>
        !inside(r + d.$1, c + d.$2) ||
        state.board[(r + d.$1) * 5 + c + d.$2] != state.turn,
  );
}

Preview flick(List<int> board, int i, int dr, int dc) {
  final b = List<int>.of(board), steps = <Slide>[];
  if (i < 0 || i >= 25 || b[i] == 0 || !directions.contains((dr, dc)))
    return Preview(b, steps);
  var active = i;
  while (true) {
    var r = active ~/ 5, c = active % 5, dest = active;
    while (inside(r + dr, c + dc) && b[(r + dr) * 5 + c + dc] == 0) {
      r += dr;
      c += dc;
      dest = r * 5 + c;
    }
    if (dest != active) {
      b[dest] = b[active];
      b[active] = 0;
      steps.add(Slide(b, active, dest));
    }
    if (!inside(r + dr, c + dc)) break;
    active = (r + dr) * 5 + c + dc;
  }
  return Preview(b, steps);
}

List<List<int>> lines(List<int> board) {
  final wins = <List<int>>[];
  for (var i = 0; i < 25; i++) {
    if (board[i] == 0) continue;
    for (final (dr, dc) in [(0, 1), (1, 0), (1, 1), (1, -1)]) {
      final r = i ~/ 5, c = i % 5;
      if (!inside(r + 2 * dr, c + 2 * dc)) continue;
      final cells = [i, (r + dr) * 5 + c + dc, (r + 2 * dr) * 5 + c + 2 * dc];
      if (cells.every((j) => board[j] == board[i])) wins.add(cells);
    }
  }
  return wins;
}

Preview? preview(GameState state, Move move) {
  if (state.result != null || move.i < 0 || move.i >= 25) return null;
  Preview out;
  if (move.type == 'place') {
    if (!canPlace(state, move.i)) return null;
    final b = List<int>.of(state.board);
    b[move.i] = state.turn;
    out = Preview(b, []);
  } else {
    if (state.board[move.i] != state.turn ||
        !directions.contains((move.dr, move.dc)))
      return null;
    out = flick(state.board, move.i, move.dr, move.dc);
  }
  if (boardKey(out.board) == boardKey(state.board) ||
      boardKey(out.board) == state.previous)
    return null;
  return out;
}

List<Move> actions(GameState state) {
  if (state.result != null) return [];
  final list = <Move>[];
  for (var i = 0; i < 25; i++) {
    if (canPlace(state, i)) list.add(Move.place(i));
    if (state.board[i] == state.turn) {
      for (final (dr, dc) in directions) {
        final m = Move.flick(i, dr, dc);
        if (preview(state, m) != null) list.add(m);
      }
    }
  }
  return list;
}

Played? play(GameState state, Move move) {
  final out = preview(state, move);
  if (out == null) return null;
  final winners = lines(
    out.board,
  ).map((cells) => out.board[cells.first]).toSet();
  final next = GameState(
    board: out.board,
    turn: 3 - state.turn,
    previous: boardKey(state.board),
    moves: state.moves + 1,
    result: winners.length > 1 ? 0 : winners.firstOrNull,
    log: [...state.log, move.by(state.turn)],
  );
  final finalState = next.result == null && actions(next).isEmpty
      ? GameState(
          board: next.board,
          turn: next.turn,
          previous: next.previous,
          moves: next.moves,
          result: 0,
          log: next.log,
        )
      : next;
  return Played(finalState, out.steps);
}

GameState? restore(dynamic log) {
  if (log is! List || log.length > 2000) return null;
  var state = GameState();
  for (final entry in log) {
    final move = Move.parse(entry);
    if (move == null || move.player != state.turn) return null;
    final out = play(state, move);
    if (out == null) return null;
    state = out.state;
  }
  return state;
}

Move? choose(GameState state, {Random? random}) {
  random ??= Random();
  var best = double.negativeInfinity;
  Move? selected;
  for (final move in actions(state)) {
    final next = play(state, move)!.state;
    double score = next.result == state.turn
        ? 10000
        : next.result == 3 - state.turn
        ? -10000
        : 0;
    if (next.result == null) {
      final threats = actions(
        next,
      ).where((reply) => play(next, reply)!.state.result == next.turn).length;
      score -= threats * 500;
      score += next.board.where((p) => p == state.turn).length * 8;
      for (var i = 0; i < 25; i++) {
        if (next.board[i] == state.turn)
          score += 4 - (i ~/ 5 - 2).abs() - (i % 5 - 2).abs();
      }
    }
    score += random.nextDouble();
    if (score > best) {
      best = score;
      selected = move;
    }
  }
  return selected;
}
