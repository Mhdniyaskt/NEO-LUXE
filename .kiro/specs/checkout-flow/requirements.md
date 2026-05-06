# Requirements Document

## Introduction

The checkout flow enables authenticated users of the Neo-Luxe e-commerce application to review their cart items, select a delivery address, place a Cash on Delivery order, and land on an order confirmation page. The feature spans four functional areas: address selection on the checkout page, order summary display, order placement, and the post-order confirmation screen.

The application is a Node.js/Express server-rendered app using EJS templates, Mongoose models, and session-based authentication. The checkout controller, views, and routes already exist in skeleton form; these requirements define the complete, correct behaviour that the implementation must satisfy.

---

## Glossary

- **Checkout_Page**: The EJS view rendered at `GET /checkout` that presents address selection, order summary, and the place-order action.
- **Order_Summary**: The panel on the Checkout_Page that lists cart items with pricing details and the final payable total.
- **Address_Selector**: The section of the Checkout_Page that lists the user's saved addresses and allows selection or navigation to add/edit addresses.
- **Checkout_Controller**: The Express controller at `controllers/user/checkout.controller.js` that handles all checkout-related HTTP requests.
- **Order_Confirmation_Page**: The EJS view rendered at `GET /orders/:orderId` after a successful order placement.
- **Cart**: The MongoDB document (model `Cart`) that holds the authenticated user's pending items, each referencing a Product and a Variant.
- **Variant**: A product variant document (model `Variant`) that carries `basePrice`, `regularPrice`, `stock`, `color`, and `images`.
- **Address**: A saved delivery address document (model `Address`) belonging to a user, with fields `fullName`, `phone`, `streetAddress`, `city`, `state`, `pincode`, `addressType`, and `isDefault`.
- **Order**: A MongoDB document (model `Order`) created on successful placement, capturing a snapshot of items, pricing, shipping address, and payment method.
- **COD**: Cash on Delivery — the only active payment method; payment is collected at delivery.
- **Subtotal**: Sum of `basePrice × quantity` for all valid cart items.
- **Tax**: 18% GST calculated on the Subtotal, rounded to the nearest integer.
- **Shipping_Fee**: ₹50 when Subtotal is below ₹5,000; ₹0 (free) when Subtotal is ₹5,000 or above.
- **Order_Total**: `Subtotal + Tax + Shipping_Fee`.
- **Stock_Clamp**: Automatic reduction of a requested quantity to the available stock when the requested quantity exceeds stock.
- **Blocked_Item**: A cart item that is unavailable for purchase due to deletion, unlisting, or zero stock.
- **Session**: The Express session object that stores the authenticated user's `id` under `req.session.user.id`.

---

## Requirements

### Requirement 1: Checkout Page — Address Selection

**User Story:** As a logged-in shopper, I want to see all my saved addresses on the checkout page with a clear default selection, so that I can quickly choose where my order should be delivered.

#### Acceptance Criteria

1. WHEN a user navigates to `GET /checkout` with a non-empty cart, THE Checkout_Controller SHALL fetch all Address documents belonging to that user and pass them to the Checkout_Page view.
2. THE Checkout_Page SHALL render each address showing `fullName`, `phone`, `streetAddress`, `city`, `state`, `pincode`, and `addressType`.
3. WHEN a user has at least one saved address, THE Checkout_Page SHALL pre-select the address whose `isDefault` field is `true`; IF no address has `isDefault: true`, THE Checkout_Page SHALL pre-select the first address in the list.
4. WHEN a user has no saved addresses, THE Checkout_Page SHALL display a prompt with a link navigating to `/addresses` so the user can add one.
5. THE Checkout_Page SHALL provide a visible link to `/addresses` that allows the user to add a new address or edit an existing one without losing checkout context.
6. WHEN a user selects a different address on the Checkout_Page, THE Checkout_Page SHALL update the visual selection state and record the chosen address ID for submission.

---

### Requirement 2: Checkout Page — Order Summary Display

**User Story:** As a shopper, I want to see a clear breakdown of my items, quantities, prices, taxes, shipping, and final total on the checkout page, so that I know exactly what I am paying before placing the order.

#### Acceptance Criteria

1. WHEN the Checkout_Page is rendered, THE Order_Summary SHALL display each cart item with its product image, product name, variant colour, quantity, and item total (`basePrice × quantity`).
2. THE Order_Summary SHALL display the Subtotal, Tax (labelled "18% GST"), and Shipping_Fee as separate line items.
3. WHEN the Subtotal is ₹5,000 or above, THE Order_Summary SHALL display the Shipping_Fee as "Free".
4. WHEN the Subtotal is below ₹5,000, THE Order_Summary SHALL display the Shipping_Fee as ₹50.
5. THE Order_Summary SHALL display the Order_Total as the sum of Subtotal, Tax, and Shipping_Fee.
6. WHEN a Variant's `regularPrice` is greater than its `basePrice`, THE Order_Summary SHALL display the `regularPrice` as a struck-through original price alongside the `basePrice` to indicate a discount.
7. WHEN one or more Blocked_Items are detected during cart validation, THE Checkout_Page SHALL display a warning listing the reason each item was blocked.
8. WHEN a Stock_Clamp is applied to one or more items, THE Checkout_Page SHALL display a notice identifying each affected item, the originally requested quantity, and the adjusted quantity.

---

### Requirement 3: Place Order — Cash on Delivery

**User Story:** As a shopper, I want to place a Cash on Delivery order from the checkout page, so that I can purchase items and pay when they are delivered.

#### Acceptance Criteria

1. WHEN a user submits `POST /checkout/place-order` with a valid `addressId` and `paymentMethod: "cod"`, THE Checkout_Controller SHALL re-validate every cart item against live stock before creating an order.
2. WHEN all cart items pass re-validation, THE Checkout_Controller SHALL atomically deduct the ordered quantity from each Variant's `stock` field using a conditional update that prevents deduction below zero.
3. WHEN stock deduction succeeds for all items, THE Checkout_Controller SHALL create an Order document with a snapshot of item details, pricing totals, the selected shipping address, `paymentMethod: "cod"`, `paymentStatus: "pending"`, and `status: "confirmed"`.
4. WHEN the Order is created successfully, THE Checkout_Controller SHALL remove the ordered items from the user's Cart and return a JSON response with `success: true`, the `orderId`, and a `redirect` URL pointing to `/orders/:orderId`.
5. IF the `addressId` is missing or does not belong to the authenticated user, THEN THE Checkout_Controller SHALL return HTTP 400 with `success: false` and a descriptive error message.
6. IF any cart item is a Blocked_Item at the time of order submission, THEN THE Checkout_Controller SHALL return HTTP 400 with `success: false`, a message listing the blocked items, and a `redirect` to `/cart`.
7. IF stock for a Variant drops below the requested quantity between validation and deduction (race condition), THEN THE Checkout_Controller SHALL roll back all previously deducted stock increments and return HTTP 409 with `success: false` and a message instructing the user to review the cart.
8. IF the user's cart is empty at the time of order submission, THEN THE Checkout_Controller SHALL return HTTP 400 with `success: false` and a message indicating the cart is empty.
9. THE Checkout_Page SHALL send the place-order request via an asynchronous `fetch` call and handle both success and error JSON responses without a full page reload, displaying error messages using a modal dialog.
10. WHEN the place-order button is clicked, THE Checkout_Page SHALL disable the button and show a loading indicator until the server responds.

---

### Requirement 4: Order Confirmation Page

**User Story:** As a shopper who has just placed an order, I want to see a confirmation page with a thank-you message, order details, and navigation options, so that I know my order was received and can take next steps.

#### Acceptance Criteria

1. WHEN a user navigates to `GET /orders/:orderId` for an order that belongs to them, THE Checkout_Controller SHALL fetch the Order document and render the Order_Confirmation_Page.
2. THE Order_Confirmation_Page SHALL display a thank-you statement and a success illustration (icon or graphic) confirming the order was placed.
3. THE Order_Confirmation_Page SHALL display the Order ID, all ordered items (with image, name, colour, quantity, and item total), the Subtotal, Tax, Shipping_Fee, and Order_Total.
4. THE Order_Confirmation_Page SHALL display the shipping address snapshot stored on the Order document.
5. THE Order_Confirmation_Page SHALL display the payment method and order status.
6. THE Order_Confirmation_Page SHALL provide a button or link navigating to `/orders` (order history).
7. THE Order_Confirmation_Page SHALL provide a button or link navigating to `/shop` (continue shopping).
8. IF the `orderId` is not a valid MongoDB ObjectId or does not belong to the authenticated user, THEN THE Checkout_Controller SHALL redirect the user to `/profile`.

---

### Requirement 5: Cart Validation on Checkout Entry

**User Story:** As a shopper, I want the checkout page to only show items that are actually available for purchase, so that I am not surprised by failures when I try to place an order.

#### Acceptance Criteria

1. WHEN a user navigates to `GET /checkout`, THE Checkout_Controller SHALL validate every cart item by checking that the Product exists, is not deleted, is active; the Category is listed; the Variant exists, is not deleted, is active; and the Variant's stock is greater than zero.
2. WHEN all cart items are Blocked_Items, THE Checkout_Controller SHALL redirect the user to `/cart` with a flash message indicating all items are unavailable.
3. WHEN a cart item's requested quantity exceeds the Variant's available stock, THE Checkout_Controller SHALL apply a Stock_Clamp, reducing the quantity to the available stock (maximum `MAX_QTY` of 10).
4. WHEN the user's cart is empty, THE Checkout_Controller SHALL redirect the user to `/cart`.
5. THE Checkout_Controller SHALL enforce a maximum purchasable quantity of 10 units per item (`MAX_QTY`), regardless of available stock.

---

### Requirement 6: Buy Now — Express Single-Item Checkout

**User Story:** As a shopper viewing a product detail page, I want to purchase a single item immediately without adding it to my cart, so that I can check out faster.

#### Acceptance Criteria

1. WHEN an authenticated user submits `POST /checkout/buy-now` with a valid `productId` and `variantId`, THE Checkout_Controller SHALL validate the product, category, and variant availability and render the Checkout_Page pre-populated with that single item.
2. IF the user is not authenticated when `POST /checkout/buy-now` is called, THEN THE Checkout_Controller SHALL return HTTP 401 JSON with `success: false` and a `redirect` to `/login`.
3. IF the product, category, or variant is unavailable (deleted, unlisted, or out of stock), THEN THE Checkout_Controller SHALL return HTTP 400 or 404 JSON with `success: false` and a descriptive error message.
4. WHEN the Buy Now checkout page is rendered, THE Order_Summary SHALL reflect the single item's pricing and totals using the same Subtotal, Tax, and Shipping_Fee calculation rules as the standard checkout.
