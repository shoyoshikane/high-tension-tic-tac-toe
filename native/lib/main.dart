import 'dart:async';
import 'dart:math' as math;

import 'package:app_links/app_links.dart';
import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:share_plus/share_plus.dart';

import 'controller.dart';
import 'game.dart';
import 'room.dart';
import 'transport.dart';

Future<void> main() => startGame();

Future<void> startGame({
  RoomPeer Function()? peerFactory,
  void Function(GameController)? onReady,
}) async {
  WidgetsFlutterBinding.ensureInitialized();
  LicenseRegistry.addLicense(() async* {
    yield LicenseEntryWithLineBreaks([
      'Noto Sans JP',
    ], await rootBundle.loadString('assets/fonts/OFL.txt'));
  });
  final links = AppLinks(), game = GameController(peerFactory: peerFactory);
  await game.load();
  final initial = kIsWeb ? Uri.base : await links.getInitialLink();
  final invitation = initial == null
      ? null
      : parseInvitation(initial.toString());
  onReady?.call(game);
  runApp(GameApp(game: game, links: kIsWeb ? null : links));
  if (invitation != null) unawaited(game.startOnline(invitation: invitation));
}

class GameApp extends StatelessWidget {
  const GameApp({super.key, required this.game, this.links, this.initial});
  final GameController game;
  final AppLinks? links;
  final Uri? initial;
  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'ハイテンション三目並べ',
    debugShowCheckedModeBanner: false,
    theme: ThemeData(
      useMaterial3: true,
      fontFamily: 'Noto Sans JP',
      colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xff354e3d)),
      scaffoldBackgroundColor: const Color(0xffeff0ed),
    ),
    home: GameScreen(game: game, links: links, initial: initial),
  );
}

class GameScreen extends StatefulWidget {
  const GameScreen({super.key, required this.game, this.links, this.initial});
  final GameController game;
  final AppLinks? links;
  final Uri? initial;
  @override
  State<GameScreen> createState() => _GameScreenState();
}

class _GameScreenState extends State<GameScreen> {
  GameController get game => widget.game;
  StreamSubscription<Uri>? _links;
  @override
  void initState() {
    super.initState();
    _links = widget.links?.uriLinkStream.listen(_incoming);
    if (widget.initial != null)
      WidgetsBinding.instance.addPostFrameCallback(
        (_) => _incoming(widget.initial!),
      );
  }

  Future<void> _incoming(Uri uri) async {
    final invitation = parseInvitation(uri.toString());
    if (invitation == null || game.room?.target == invitation.target) return;
    if (await _confirmLeave()) await game.startOnline(invitation: invitation);
  }

  Future<bool> _confirmLeave() async {
    if (game.state.moves == 0 && !game.online) return true;
    return await showDialog<bool>(
          context: context,
          builder: (context) => AlertDialog(
            title: const Text('対局を終了しますか？'),
            content: const Text('いまの対局を終了して切り替えます。'),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(context, false),
                child: const Text('続ける'),
              ),
              FilledButton(
                onPressed: () => Navigator.pop(context, true),
                child: const Text('切り替える'),
              ),
            ],
          ),
        ) ??
        false;
  }

  Future<void> _online() async {
    if (game.online) return;
    final input = TextEditingController();
    final result = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      builder: (context) => Padding(
        padding: EdgeInsets.fromLTRB(
          24,
          28,
          24,
          MediaQuery.viewInsetsOf(context).bottom + 28,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text(
              'オンライン対戦',
              style: TextStyle(fontSize: 20, fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 24),
            FilledButton(
              onPressed: () => Navigator.pop(context, ''),
              child: const Text('部屋を作る'),
            ),
            const SizedBox(height: 24),
            TextField(
              controller: input,
              decoration: InputDecoration(
                labelText: '招待リンク',
                hintText: '友達から届いたリンクを貼り付け',
                suffixIcon: IconButton(
                  tooltip: '貼り付け',
                  icon: const Icon(Icons.content_paste),
                  onPressed: () async {
                    final data = await Clipboard.getData(Clipboard.kTextPlain);
                    input.text = data?.text ?? '';
                  },
                ),
              ),
            ),
            const SizedBox(height: 12),
            OutlinedButton(
              onPressed: () {
                if (parseInvitation(input.text) == null) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('招待リンクを確認してください')),
                  );
                  return;
                }
                Navigator.pop(context, input.text);
              },
              child: const Text('参加する'),
            ),
          ],
        ),
      ),
    );
    input.dispose();
    if (result == null || !mounted) return;
    if (await _confirmLeave())
      await game.startOnline(
        invitation: result.isEmpty ? null : parseInvitation(result),
      );
  }

  Future<void> _share(BuildContext context) async {
    final invite = game.room?.invite;
    if (invite == null || invite.isEmpty) return;
    final box = context.findRenderObject() as RenderBox?;
    try {
      await SharePlus.instance.share(
        ShareParams(
          text: '一緒にハイテンション三目並べを遊ぼう！\n$invite',
          subject: 'ハイテンション三目並べ',
          mailToFallbackEnabled: false,
          sharePositionOrigin: box == null
              ? null
              : box.localToGlobal(Offset.zero) & box.size,
        ),
      );
    } catch (_) {
      await Clipboard.setData(ClipboardData(text: invite));
      if (mounted)
        ScaffoldMessenger.of(
          this.context,
        ).showSnackBar(const SnackBar(content: Text('招待リンクをコピーしました')));
    }
  }

  void _rules() => showDialog<void>(
    context: context,
    builder: (context) => AlertDialog(
      title: const Text('遊び方'),
      content: const SingleChildScrollView(
        child: Text(
          '先攻は黒、後攻は白。縦・横・斜めに3つ連続で並べると勝ち。コマは各5個です。\n\n空きマスをタップして置きます。自分のコマの周囲8マスには置けません。\n\n自分のコマを8方向へドラッグして弾きます。移動後の盤面をプレビューし、盤の上で離すと確定。盤の外や元の位置で離すとキャンセルです。衝突したコマに移動が連鎖します。\n\n直前の手番開始時の配置に戻す手は選べません。両者同時に揃った場合と合法手がない場合は引き分けです。\n\nオンラインは招待リンクで参加します。満員なら自動で観戦モードになります。「もう一局」は両者の同意で開始します。',
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('閉じる'),
        ),
      ],
    ),
  );
  @override
  void dispose() {
    unawaited(_links?.cancel() ?? Future.value());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: game,
    builder: (context, _) {
      final watching = game.spectator,
          ink = watching ? Colors.white : const Color(0xff262a29);
      return Scaffold(
        backgroundColor: watching
            ? const Color(0xfff01832)
            : const Color(0xffeff0ed),
        body: SafeArea(
          child: SingleChildScrollView(
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 560),
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(22, 16, 22, 28),
                  child: Column(
                    children: [
                      Row(
                        children: [
                          Icon(Icons.more_horiz, color: ink),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              'ハイテンション三目並べ',
                              style: TextStyle(
                                color: ink,
                                fontWeight: FontWeight.w600,
                                fontSize: 15,
                              ),
                            ),
                          ),
                          IconButton(
                            tooltip: '遊び方',
                            onPressed: _rules,
                            icon: Icon(Icons.help_outline, color: ink),
                          ),
                        ],
                      ),
                      const SizedBox(height: 24),
                      Container(
                        padding: const EdgeInsets.all(4),
                        decoration: BoxDecoration(
                          border: Border.all(color: ink.withValues(alpha: .15)),
                          borderRadius: BorderRadius.circular(30),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            _mode('CPU対戦', !game.online, ink, () async {
                              if (!game.online) return;
                              if (await _confirmLeave()) await game.startCpu();
                            }),
                            _mode('オンライン対戦', game.online, ink, _online),
                          ],
                        ),
                      ),
                      const SizedBox(height: 26),
                      if (watching)
                        Container(
                          key: const Key('spectator-badge'),
                          padding: const EdgeInsets.symmetric(
                            horizontal: 18,
                            vertical: 10,
                          ),
                          margin: const EdgeInsets.only(bottom: 22),
                          decoration: BoxDecoration(
                            color: const Color(0xff9e001d),
                            borderRadius: BorderRadius.circular(28),
                            border: Border.all(color: Colors.white54),
                          ),
                          child: const Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(
                                Icons.visibility_outlined,
                                color: Colors.white,
                                size: 18,
                              ),
                              SizedBox(width: 8),
                              Text(
                                '観戦モード',
                                style: TextStyle(
                                  color: Colors.white,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ],
                          ),
                        ),
                      if (game.online &&
                          (game.room?.ready != true ||
                              game.room!.invite.isNotEmpty ||
                              game.room!.localVote ||
                              game.room!.remoteVote)) ...[
                        if (game.room?.ready != true ||
                            game.room!.localVote ||
                            game.room!.remoteVote)
                          Text(
                            game.roomStatus,
                            style: TextStyle(color: ink, fontSize: 11),
                            textAlign: TextAlign.center,
                          ),
                        Wrap(
                          alignment: WrapAlignment.center,
                          children: [
                            if (game.room?.invite.isNotEmpty == true)
                              Builder(
                                builder: (context) => TextButton(
                                  onPressed: () => _share(context),
                                  child: Text(
                                    '招待リンクを共有 ↗',
                                    style: TextStyle(color: ink),
                                  ),
                                ),
                              ),
                            if (game.room?.ready != true)
                              TextButton(
                                onPressed: game.retry,
                                child: Text(
                                  '再接続',
                                  style: TextStyle(color: ink),
                                ),
                              ),
                          ],
                        ),
                        const SizedBox(height: 16),
                      ],
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [_player(1, ink), _player(2, ink)],
                      ),
                      const SizedBox(height: 18),
                      GameBoard(game: game),
                      const SizedBox(height: 20),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          _miniStone(
                            game.state.result == null || game.state.result == 0
                                ? game.state.turn
                                : game.state.result!,
                            8,
                          ),
                          const SizedBox(width: 8),
                          Text(
                            game.turnLabel,
                            key: const Key('turn-label'),
                            style: TextStyle(
                              color: ink,
                              fontWeight: FontWeight.w600,
                              fontSize: 12,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 8),
                      Text(
                        game.hint,
                        style: TextStyle(
                          color: ink.withValues(alpha: .7),
                          fontSize: 11,
                        ),
                      ),
                      const SizedBox(height: 12),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          if (!game.online)
                            IconButton(
                              tooltip: '一手戻す',
                              onPressed: game.canUndo ? game.undo : null,
                              icon: const Icon(Icons.undo),
                            ),
                          if (!watching)
                            TextButton(
                              onPressed:
                                  game.online &&
                                      (game.room?.ready != true ||
                                          game.room!.localVote)
                                  ? null
                                  : () async {
                                      if (game.online) {
                                        game.rematch();
                                        return;
                                      }
                                      if (await _confirmLeave())
                                        await game.startCpu();
                                    },
                              child: Text(game.online ? 'もう一局' : '新しい対局'),
                            ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      );
    },
  );
  Widget _mode(String title, bool active, Color ink, VoidCallback action) =>
      TextButton(
        style: TextButton.styleFrom(
          foregroundColor: active
              ? game.spectator
                    ? const Color(0xffb50020)
                    : Colors.white
              : ink,
          backgroundColor: active ? ink : Colors.transparent,
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
        ),
        onPressed: action,
        child: Text(title, style: const TextStyle(fontSize: 12)),
      );
  Widget _player(int p, Color ink) {
    final count = game.state.board.where((v) => v == p).length;
    final tag = game.online
        ? game.spectator
              ? ''
              : game.room?.role == p
              ? 'あなた'
              : '相手'
        : p == 1
        ? 'あなた'
        : 'CPU';
    return Opacity(
      opacity: game.state.turn == p && game.state.result == null ? 1 : .55,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            p == 1 ? '先攻' : '後攻',
            style: TextStyle(color: ink, fontSize: 11),
          ),
          const SizedBox(width: 7),
          Text(
            tag,
            style: TextStyle(color: ink.withValues(alpha: .65), fontSize: 9),
          ),
          const SizedBox(width: 12),
          ...List.generate(
            5,
            (i) => Padding(
              padding: const EdgeInsets.only(left: 4),
              child: _miniStone(i < 5 - count ? p : 0, 7),
            ),
          ),
        ],
      ),
    );
  }

  Widget _miniStone(int p, double size) => Container(
    width: size,
    height: size,
    decoration: BoxDecoration(
      shape: BoxShape.circle,
      color: p == 0
          ? Colors.transparent
          : p == 1
          ? const Color(0xff171717)
          : Colors.white,
      border: Border.all(
        color: p == 1
            ? const Color(0xff171717)
            : game.spectator
            ? Colors.white60
            : const Color(0xffa5ada4),
      ),
    ),
  );
}

class GameBoard extends StatefulWidget {
  const GameBoard({super.key, required this.game});
  final GameController game;
  @override
  State<GameBoard> createState() => _GameBoardState();
}

class _GameBoardState extends State<GameBoard> {
  int? _selected;
  Offset? _origin, _last;
  Preview? _ghost;
  (int, int)? _aim;
  double _size = 0;
  int _revision = -1;
  @override
  void initState() {
    super.initState();
    widget.game.addListener(_cancel);
  }

  @override
  void dispose() {
    widget.game.removeListener(_cancel);
    super.dispose();
  }

  void _cancel() {
    if (mounted)
      setState(() {
        _selected = null;
        _ghost = null;
        _aim = null;
        _origin = null;
        _last = null;
      });
  }

  int? _cell(Offset p) {
    if (p.dx < 0 || p.dy < 0 || p.dx >= _size || p.dy >= _size) return null;
    return (p.dy / (_size / 5)).floor() * 5 + (p.dx / (_size / 5)).floor();
  }

  void _start(DragStartDetails details) {
    if (!widget.game.canInteract) return;
    final p = _origin ?? details.localPosition, i = _cell(p);
    if (i == null || widget.game.state.board[i] != widget.game.state.turn)
      return;
    setState(() {
      _selected = i;
      _origin = p;
      _revision = widget.game.state.moves;
    });
    _update(details.localPosition);
  }

  void _update(Offset p) {
    if (_selected == null || _origin == null) return;
    _last = p;
    final delta = p - _origin!;
    setState(() {
      if (delta.distance < 18) {
        _aim = null;
        _ghost = null;
        return;
      }
      final angle =
          (math.atan2(delta.dy, delta.dx) / (math.pi / 4)).round() *
          math.pi /
          4;
      _aim = (math.sin(angle).round(), math.cos(angle).round());
      _ghost = preview(
        widget.game.state,
        Move.flick(_selected!, _aim!.$1, _aim!.$2),
      );
    });
  }

  void _end() {
    final valid =
        _last != null &&
        _cell(_last!) != null &&
        _ghost != null &&
        _aim != null &&
        _selected != null &&
        _revision == widget.game.state.moves &&
        widget.game.canInteract;
    final move = valid ? Move.flick(_selected!, _aim!.$1, _aim!.$2) : null;
    _cancel();
    if (move != null) widget.game.move(move);
  }

  void _tap(int i) {
    final game = widget.game;
    if (!game.canInteract) return;
    if (game.state.board[i] == game.state.turn) {
      setState(() {
        _selected = i;
        _ghost = null;
        _aim = null;
      });
    } else {
      game.move(Move.place(i));
    }
  }

  KeyEventResult _key(FocusNode node, KeyEvent event) {
    if (event is! KeyDownEvent || _selected == null)
      return KeyEventResult.ignored;
    if (event.logicalKey == LogicalKeyboardKey.escape) {
      _cancel();
      return KeyEventResult.handled;
    }
    if (!widget.game.canInteract) return KeyEventResult.ignored;
    final vector = {
      LogicalKeyboardKey.arrowUp: (-1, 0),
      LogicalKeyboardKey.arrowDown: (1, 0),
      LogicalKeyboardKey.arrowLeft: (0, -1),
      LogicalKeyboardKey.arrowRight: (0, 1),
      LogicalKeyboardKey.keyQ: (-1, -1),
      LogicalKeyboardKey.keyE: (-1, 1),
      LogicalKeyboardKey.keyZ: (1, -1),
      LogicalKeyboardKey.keyC: (1, 1),
    }[event.logicalKey];
    if (vector != null) {
      setState(() {
        _aim = vector;
        _ghost = preview(
          widget.game.state,
          Move.flick(_selected!, vector.$1, vector.$2),
        );
      });
      return KeyEventResult.handled;
    }
    if (event.logicalKey == LogicalKeyboardKey.enter &&
        _ghost != null &&
        _aim != null) {
      final move = Move.flick(_selected!, _aim!.$1, _aim!.$2);
      _cancel();
      widget.game.move(move);
      return KeyEventResult.handled;
    }
    return KeyEventResult.ignored;
  }

  @override
  Widget build(BuildContext context) {
    final game = widget.game,
        red = game.spectator,
        b = _ghost?.board ?? game.state.board;
    final winning = game.state.result != null
        ? lines(game.state.board).expand((c) => c).toSet()
        : <int>{};
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: red ? const Color(0xffcb0924) : const Color(0xfffafbf7),
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: red ? const Color(0xffff8594) : Colors.white),
        boxShadow: const [
          BoxShadow(
            color: Color(0x2024352b),
            blurRadius: 30,
            offset: Offset(0, 14),
          ),
        ],
      ),
      child: AspectRatio(
        aspectRatio: 1,
        child: LayoutBuilder(
          builder: (context, constraints) {
            _size = constraints.maxWidth;
            return Focus(
              autofocus: true,
              onKeyEvent: _key,
              child: Listener(
                // Accepted Flutter drags also emit onPanEnd on pointer cancel.
                // Clear the preview before the recognizer processes that event.
                onPointerCancel: (_) => _cancel(),
                child: GestureDetector(
                  key: const Key('board'),
                  behavior: HitTestBehavior.opaque,
                  onPanDown: (d) {
                    _origin = d.localPosition;
                  },
                  onPanStart: _start,
                  onPanUpdate: (d) => _update(d.localPosition),
                  onPanEnd: (_) => _end(),
                  onPanCancel: _cancel,
                  onTapUp: (d) {
                    final i = _cell(d.localPosition);
                    if (i != null) _tap(i);
                  },
                  child: Stack(
                    children: [
                      GridView.count(
                        crossAxisCount: 5,
                        padding: EdgeInsets.zero,
                        mainAxisSpacing: 3,
                        crossAxisSpacing: 3,
                        physics: const NeverScrollableScrollPhysics(),
                        children: List.generate(25, (i) {
                          final changed =
                              _ghost != null && b[i] != game.state.board[i];
                          return Semantics(
                            label:
                                '${'ABCDE'[i % 5]}${i ~/ 5 + 1} ${game.state.board[i] == 0
                                    ? '空きマス'
                                    : game.state.board[i] == 1
                                    ? '黒のコマ'
                                    : '白のコマ'}',
                            button: true,
                            enabled: game.canInteract,
                            onTap:
                                game.canInteract &&
                                    (canPlace(game.state, i) ||
                                        game.state.board[i] == game.state.turn)
                                ? () => _tap(i)
                                : null,
                            child: Container(
                              key: Key('cell-$i'),
                              decoration: BoxDecoration(
                                color: winning.contains(i)
                                    ? const Color(0xffdbd6a8)
                                    : red
                                    ? Colors.white.withValues(
                                        alpha: changed ? .2 : .09,
                                      )
                                    : changed
                                    ? const Color(0xffd6e0d7)
                                    : const Color(0xffe8ece5),
                                borderRadius: BorderRadius.circular(7),
                                border: _selected == i
                                    ? Border.all(
                                        color: red
                                            ? Colors.white70
                                            : const Color(0xff7d9284),
                                        width: 1.5,
                                      )
                                    : null,
                              ),
                              child: Center(
                                child: b[i] != 0
                                    ? FractionallySizedBox(
                                        widthFactor: .64,
                                        child: AspectRatio(
                                          aspectRatio: 1,
                                          child: Opacity(
                                            opacity: changed ? .65 : 1,
                                            child: _Stone(player: b[i]),
                                          ),
                                        ),
                                      )
                                    : canPlace(game.state, i) &&
                                          game.canInteract
                                    ? Container(
                                        width: 4,
                                        height: 4,
                                        decoration: const BoxDecoration(
                                          color: Color(0xffa8b3a9),
                                          shape: BoxShape.circle,
                                        ),
                                      )
                                    : null,
                              ),
                            ),
                          );
                        }),
                      ),
                      if (_aim != null && _selected != null)
                        IgnorePointer(
                          child: CustomPaint(
                            size: Size.square(_size),
                            painter: _AimPainter(
                              _selected!,
                              _aim!,
                              _ghost != null,
                              red,
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
              ),
            );
          },
        ),
      ),
    );
  }
}

class _Stone extends StatelessWidget {
  const _Stone({required this.player});
  final int player;
  @override
  Widget build(BuildContext context) => DecoratedBox(
    decoration: BoxDecoration(
      shape: BoxShape.circle,
      border: Border.all(
        color: player == 1 ? const Color(0xff141818) : const Color(0xffd0d7cd),
      ),
      gradient: RadialGradient(
        center: const Alignment(-.45, -.6),
        radius: 1,
        colors: player == 1
            ? const [Color(0xffa5a5a5), Color(0xff626262), Color(0xff171717)]
            : const [Colors.white, Color(0xfffcfdf6), Color(0xffc5cfc1)],
        stops: const [0, .25, 1],
      ),
      boxShadow: const [
        BoxShadow(
          color: Color(0x35354434),
          blurRadius: 9,
          offset: Offset(2, 6),
        ),
      ],
    ),
  );
}

class _AimPainter extends CustomPainter {
  _AimPainter(this.i, this.direction, this.valid, this.red);
  final int i;
  final (int, int) direction;
  final bool valid, red;
  @override
  void paint(Canvas canvas, Size size) {
    final start = Offset(
          (i % 5 + .5) * size.width / 5,
          (i ~/ 5 + .5) * size.height / 5,
        ),
        angle = math.atan2(direction.$1, direction.$2),
        length = size.width * .16;
    final end = start + Offset(math.cos(angle), math.sin(angle)) * length;
    final pen = Paint()
      ..color = valid
          ? red
                ? Colors.white
                : const Color(0xff4c6756)
          : const Color(0xff9b7164)
      ..strokeWidth = 2
      ..strokeCap = StrokeCap.round;
    canvas.drawLine(start, end, pen);
    for (final sign in [-1, 1]) {
      canvas.drawLine(
        end,
        end -
            Offset(math.cos(angle + sign * .6), math.sin(angle + sign * .6)) *
                9,
        pen,
      );
    }
  }

  @override
  bool shouldRepaint(_AimPainter old) =>
      old.i != i ||
      old.direction != direction ||
      old.valid != valid ||
      old.red != red;
}
