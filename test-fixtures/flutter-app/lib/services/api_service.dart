import 'package:dio/dio.dart';

class ApiService {
  final Dio _dio;
  static const baseUrl = 'https://api.example.com/v1';

  ApiService() : _dio = Dio(BaseOptions(baseUrl: baseUrl));

  Future<Response> login(String email, String password) {
    return _dio.post('/auth/login', data: {'email': email, 'password': password});
  }

  Future<Response> register(String email, String password, String name) {
    return _dio.post('/auth/register', data: {'email': email, 'password': password, 'name': name});
  }

  Future<Response> getProducts({int page = 1, int limit = 20, String? category}) {
    return _dio.get('/products', queryParameters: {'page': page, 'limit': limit, 'category': category});
  }

  Future<Response> getProduct(String id) {
    return _dio.get('/products/$id');
  }

  Future<Response> getCart() {
    return _dio.get('/cart');
  }

  Future<Response> addToCart(String productId, int quantity) {
    return _dio.post('/cart/items', data: {'productId': productId, 'quantity': quantity});
  }
}
