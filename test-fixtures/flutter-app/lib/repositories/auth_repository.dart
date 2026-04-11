import '../models/user.dart';

abstract class AuthRepository {
  Future<User> login(String email, String password);
  Future<void> logout();
  Future<User?> currentUser();
}

class AuthRepositoryImpl extends AuthRepository {
  @override
  Future<User> login(String email, String password) async {
    throw UnimplementedError();
  }

  @override
  Future<void> logout() async {}

  @override
  Future<User?> currentUser() async => null;
}
