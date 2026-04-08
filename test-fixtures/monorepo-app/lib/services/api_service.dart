import 'package:dio/dio.dart';

class ApiService {
  final Dio _dio;
  static const baseUrl = 'https://api.example.com/v1';

  ApiService() : _dio = Dio(BaseOptions(baseUrl: baseUrl));

  // These match Express routes (with /api prefix handled by backend mount)
  Future<Response> login(String email, String password) {
    return _dio.post('/auth/login', data: {'email': email, 'password': password});
  }

  Future<Response> register(String email, String password) {
    return _dio.post('/auth/register', data: {'email': email, 'password': password});
  }

  Future<Response> listPosts() {
    return _dio.get('/posts');
  }

  Future<Response> getPost(String id) {
    return _dio.get('/posts/$id');
  }

  // This mobile call has NO matching backend route — should show up as unmatched
  Future<Response> getUnknownStuff() {
    return _dio.get('/mobile-only/widgets');
  }
}
