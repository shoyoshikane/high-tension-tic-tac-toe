import 'package:web/web.dart' as web;

void setInvitation(String target, bool spectator) {
  final uri = Uri.base.replace(
    fragment: target.isEmpty
        ? ''
        : Uri(
            queryParameters: {'room': target, if (spectator) 'watch': '1'},
          ).query,
  );
  if (uri.toString() != web.window.location.href) {
    web.window.history.replaceState(null, '', uri.toString());
  }
}
