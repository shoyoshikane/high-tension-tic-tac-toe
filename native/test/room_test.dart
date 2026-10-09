import 'package:flutter_test/flutter_test.dart';
import 'package:high_tension_tic_tac_toe/game.dart';
import 'package:high_tension_tic_tac_toe/room.dart';

import 'fakes.dart';

Future<void> settle() async {
  for (var i = 0; i < 8; i++) {
    await Future<void>.delayed(Duration.zero);
  }
}

void main() {
  test('invite parsing accepts shared Web text and custom native links', () {
    expect(parseInvitation('遊ぼう！\n${webGameUrl}#room=friend&watch=1'), (
      target: 'friend',
      spectator: true,
    ));
    expect(parseInvitation('hightension://join?room=friend'), (
      target: 'friend',
      spectator: false,
    ));
    expect(parseInvitation('https://example.com/no-room'), isNull);
  });
  test(
    'host-authoritative moves, automatic spectators, forged moves, rematches and reconnection',
    () async {
      final hub = FakeHub();
      OnlineRoom make() => OnlineRoom(
        peerFactory: hub.create,
        onState: (_, _) {},
        onStatus: (_) {},
      );
      final host = make(), guest = make(), viewer = make();
      try {
        await host.start();
        final target = parseInvitation(host.invite)!.target;
        await guest.start(target: target);
        await settle();
        expect(host.ready, isTrue);
        expect(guest.ready, isTrue);
        expect(host.move(const Move.place(0)), isTrue);
        await settle();
        expect(guest.state.board[0], 1);
        await viewer.start(target: target);
        await settle();
        expect(viewer.spectator, isTrue);
        expect(viewer.role, 0);
        expect(viewer.state.moves, 1);
        expect(viewer.move(const Move.place(2)), isFalse);
        viewer.rematch();
        expect(viewer.localVote, isFalse);
        final viewerPeer = hub.peers.values.last;
        await viewerPeer.connections.first.send({
          'type': 'move',
          'version': 1,
          'match': host.match,
          'rev': 1,
          'action': const Move.place(2).toJson(),
        });
        await settle();
        expect(host.state.moves, 1);
        expect(guest.move(const Move.place(2)), isTrue);
        await settle();
        expect(viewer.state.moves, 2);
        expect(host.move(const Move.flick(0, 0, 1)), isTrue);
        await settle();
        expect(viewer.state.board[1], 1);
        expect(viewer.state.board[4], 2);
        host.rematch();
        await settle();
        expect(viewer.localVote, isFalse);
        guest.rematch();
        await settle();
        expect(host.state.moves, 0);
        expect(viewer.state.moves, 0);
        final guestPeer = hub.peers.values.firstWhere(
          (p) => p != hub.peers[target] && p != viewerPeer,
        );
        await guestPeer.connections.first.close();
        await settle();
        expect(host.ready, isFalse);
        expect(viewer.playing, isFalse);
        await guest.retry();
        await settle();
        expect(guest.role, 2);
        expect(guest.spectator, isFalse);
        expect(host.ready, isTrue);
        expect(viewer.playing, isTrue);
      } finally {
        await host.close();
        await guest.close();
        await viewer.close();
      }
    },
  );
}
