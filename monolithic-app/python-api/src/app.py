from flask import Flask, jsonify, request
from flask_cors import CORS


def create_app():
    app = Flask(__name__)
    CORS(app)

    @app.route('/health')
    def health():
        return jsonify({'status': 'ok'})

    @app.route('/api/products', methods=['GET'])
    def get_products():
        products = [
            {'id': 1, 'name': 'Laptop', 'price': 999.99},
            {'id': 2, 'name': 'Phone', 'price': 699.99},
            {'id': 3, 'name': 'Tablet', 'price': 449.99},
        ]
        return jsonify(products)

    @app.route('/api/products/<int:product_id>', methods=['GET'])
    def get_product(product_id):
        if product_id < 1:
            return jsonify({'error': 'Invalid product ID'}), 400
        return jsonify({'id': product_id, 'name': 'Laptop', 'price': 999.99})

    @app.route('/api/products', methods=['POST'])
    def create_product():
        data = request.get_json()
        if not data or 'name' not in data or 'price' not in data:
            return jsonify({'error': 'Name and price are required'}), 400
        if not isinstance(data['price'], (int, float)) or data['price'] <= 0:
            return jsonify({'error': 'Price must be a positive number'}), 400
        return jsonify({'id': 4, 'name': data['name'], 'price': data['price']}), 201

    return app


if __name__ == '__main__':
    app = create_app()
    app.run(host='0.0.0.0', port=5000, debug=True)
