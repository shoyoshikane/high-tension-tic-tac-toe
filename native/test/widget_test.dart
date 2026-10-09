import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:high_tension_tic_tac_toe/controller.dart';
import 'package:high_tension_tic_tac_toe/game.dart';
import 'package:high_tension_tic_tac_toe/main.dart';

import 'fakes.dart';

void main() {
  testWidgets(
    'reach badges identify both colors and disappear when the threat ends',
    (tester) async {
      final game = GameController();
      addTearDown(game.dispose);
      final b = List.filled(25, 0);
      for (final i in [0, 1, 7]) {
        b[i] = 1;
      }
      for (final i in [17, 20, 21]) {
        b[i] = 2;
      }
      game.state = GameState(board: b);
      await tester.pumpWidget(GameApp(game: game));
      expect(find.text('先攻 リーチ'), findsOneWidget);
      expect(find.text('後攻 リーチ'), findsOneWidget);
      game.state = GameState();
      game.changed();
      await tester.pump();
      expect(find.byKey(const Key('reach-1')), findsNothing);
      expect(find.byKey(const Key('reach-2')), findsNothing);
    },
  );
  testWidgets('placement, drag preview, cancellation, commit and undo', (
    tester,
  ) async {
    final game = GameController();
    addTearDown(game.dispose);
    game.state = play(
      play(GameState(), const Move.place(0))!.state,
      const Move.place(2),
    )!.state;
    await tester.pumpWidget(GameApp(game: game));
    expect(find.text('CPU対戦'), findsOneWidget);
    expect(find.text('オンライン対戦'), findsOneWidget);
    final start = tester.getCenter(find.byKey(const Key('cell-0')));
    final gesture = await tester.startGesture(start);
    await gesture.moveTo(start + const Offset(60, 0));
    await tester.pump();
    expect(game.state.moves, 2);
    await gesture.cancel();
    await tester.pump();
    expect(game.state.moves, 2);
    final next = await tester.startGesture(start);
    await next.moveTo(start + const Offset(60, 0));
    await tester.pump();
    await next.up();
    await tester.pump();
    expect(game.state.moves, 3);
    expect(game.state.board[1], 1);
    expect(game.state.board[4], 2);
    game.undo();
    await tester.pump();
    expect(game.state.moves, 2);
  });
  testWidgets(
    'spectators have a red screen, a persistent badge, and no game actions',
    (tester) async {
      final hub = FakeHub(),
          host = GameController(peerFactory: () => hub.create()),
          guest = GameController(peerFactory: () => hub.create()),
          viewer = GameController(peerFactory: () => hub.create());
      addTearDown(() {
        host.dispose();
        guest.dispose();
        viewer.dispose();
      });
      await host.startOnline();
      final target = host.room!.invite.split('room=').last;
      await guest.startOnline(invitation: (target: target, spectator: false));
      await viewer.startOnline(invitation: (target: target, spectator: false));
      await tester.pumpWidget(GameApp(game: viewer));
      await tester.pump();
      expect(viewer.spectator, isTrue);
      expect(find.text('観戦モード'), findsOneWidget);
      expect(find.text('もう一局'), findsNothing);
      final scaffold = tester.widget<Scaffold>(find.byType(Scaffold));
      expect(scaffold.backgroundColor, const Color(0xfff01832));
      await tester.tap(find.byKey(const Key('cell-12')));
      await tester.pump();
      expect(host.state.moves, 0);
      await viewer.room!.close();
      await guest.room!.close();
      await host.room!.close();
      await tester.pump();
    },
  );
}
