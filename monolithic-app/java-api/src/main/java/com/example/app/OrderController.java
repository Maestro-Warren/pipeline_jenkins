package com.example.app;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/orders")
public class OrderController {

    private final List<Map<String, Object>> orders = List.of(
        Map.of("id", 1, "product", "Laptop", "quantity", 2, "total", 1999.98),
        Map.of("id", 2, "product", "Phone", "quantity", 1, "total", 699.99)
    );

    @GetMapping
    public ResponseEntity<List<Map<String, Object>>> getOrders() {
        return ResponseEntity.ok(orders);
    }

    @GetMapping("/{id}")
    public ResponseEntity<?> getOrder(@PathVariable int id) {
        if (id < 1) {
            return ResponseEntity.badRequest().body(Map.of("error", "Invalid order ID"));
        }
        return orders.stream()
            .filter(o -> (int) o.get("id") == id)
            .findFirst()
            .map(ResponseEntity::ok)
            .orElse(ResponseEntity.notFound().build());
    }

    @PostMapping
    public ResponseEntity<?> createOrder(@RequestBody Map<String, Object> body) {
        if (!body.containsKey("product") || !body.containsKey("quantity")) {
            return ResponseEntity.badRequest().body(Map.of("error", "Product and quantity are required"));
        }
        Map<String, Object> newOrder = Map.of(
            "id", 3,
            "product", body.get("product"),
            "quantity", body.get("quantity"),
            "total", 999.99
        );
        return ResponseEntity.status(HttpStatus.CREATED).body(newOrder);
    }
}
