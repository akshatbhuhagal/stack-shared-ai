import 'package:get_it/get_it.dart';
import 'package:injectable/injectable.dart';
import 'services/auth_service.dart';
import 'services/product_service.dart';

final getIt = GetIt.instance;

void configureDependencies() {
  getIt.registerLazySingleton<AuthService>(() => AuthService());
  getIt.registerFactory<ProductService>(() => ProductService());
  getIt.registerSingleton<String>('api-key-placeholder');
}

@injectable
class AnalyticsService {
  void track(String event) {}
}

@lazySingleton
class CacheService {
  final Map<String, Object> _cache = {};
}
