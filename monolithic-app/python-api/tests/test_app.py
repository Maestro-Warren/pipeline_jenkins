import pytest
from src.app import create_app


@pytest.fixture
def client():
    app = create_app()
    app.config['TESTING'] = True
    with app.test_client() as client:
        yield client


def test_health(client):
    response = client.get('/health')
    assert response.status_code == 200
    assert response.get_json()['status'] == 'ok'


def test_get_products(client):
    response = client.get('/api/products')
    assert response.status_code == 200
    data = response.get_json()
    assert isinstance(data, list)
    assert len(data) > 0
    assert 'id' in data[0]
    assert 'name' in data[0]
    assert 'price' in data[0]


def test_get_product_by_id(client):
    response = client.get('/api/products/1')
    assert response.status_code == 200
    data = response.get_json()
    assert data['id'] == 1


def test_get_product_invalid_id(client):
    response = client.get('/api/products/0')
    assert response.status_code == 400


def test_create_product(client):
    response = client.post('/api/products', json={
        'name': 'Monitor',
        'price': 349.99
    })
    assert response.status_code == 201
    data = response.get_json()
    assert data['name'] == 'Monitor'
    assert data['price'] == 349.99


def test_create_product_missing_fields(client):
    response = client.post('/api/products', json={'name': 'Monitor'})
    assert response.status_code == 400


def test_create_product_invalid_price(client):
    response = client.post('/api/products', json={
        'name': 'Monitor',
        'price': -10
    })
    assert response.status_code == 400
