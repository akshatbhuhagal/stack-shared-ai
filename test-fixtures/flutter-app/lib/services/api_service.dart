import 'package:dio/dio.dart';

class AuthInterceptor extends Interceptor {
  final String Function() getToken;
  AuthInterceptor(this.getToken);

  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    options.headers['Authorization'] = 'Bearer ${getToken()}';
    handler.next(options);
  }
}

class LoggingInterceptor extends InterceptorsWrapper {
  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    // ignore: avoid_print
    print('→ ${options.method} ${options.uri}');
    handler.next(options);
  }

  @override
  void onResponse(Response response, ResponseInterceptorHandler handler) {
    // ignore: avoid_print
    print('← ${response.statusCode} ${response.requestOptions.uri}');
    handler.next(response);
  }
}

class ApiService {
  final Dio _dio;
  static const baseUrl = 'https://api.example.com/v1';

  ApiService(String Function() tokenProvider)
      : _dio = Dio(BaseOptions(baseUrl: baseUrl)) {
    _dio.interceptors.add(AuthInterceptor(tokenProvider));
    _dio.interceptors.add(LoggingInterceptor());
  }

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
