import 'package:auto_route/auto_route.dart';
import '../screens/home_screen.dart';
import '../screens/profile_screen.dart';
import '../screens/settings_screen.dart';

@AutoRouterConfig()
class AppRouter extends RootStackRouter {
  @override
  List<AutoRoute> get routes => [
        AutoRoute(page: HomeRoute.page, path: '/', initial: true),
        AutoRoute(
          page: ProfileRoute.page,
          path: '/profile/:userId',
          guards: [AuthGuard],
        ),
        AutoRoute(page: SettingsRoute.page, path: '/settings'),
      ];
}
