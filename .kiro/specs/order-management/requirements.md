# Requirements Document

## Introduction

The Order Management feature provides Neo-Luxe users with a complete self-service interface for viewing, tracking, managing, and downloading records of their orders. Users can browse their order history, search for specific orders, view detailed order information with a delivery timeline, cancel entire orders or individual items (with optional reason), request returns for delivered orders (with mandatory reason), and download PDF invoices. Stock is automatically restored when items are cancelled. Order IDs are displayed in a human-readable format (e.g. `#LX-88394-2024`) rather than raw MongoDB ObjectIds.

---

## Glossary

- **Order_Management_System**: The server-side and client-side components that handle order listing, detail, cancellation, return, and invoice generation.
- **Order**: A confirmed purchase record stored in the `orders` collection, containing one or more items, pricing snapshots, a shipping address snapshot, payment information, and a lifecycle status.
- **Order_Item**: A single product-variant line within an Order, carrying a snapshot of product name, variant colour, image, prices, quantity, and item total.
- **Display_Order_ID**: A human-readable identifier derived from the Order's MongoDB ObjectId, formatted as `#LX-{5-digit-numeric-segment}-{year}` (e.g. `#LX-88394-2024`).
- **Order_Status**: The current lifecycle stage of an Order — one of `pending`, `confirmed`, `processing`, `shipped`, `delivered`, `cancelled`, or `returned`.
- **Item_Status**: The cancellation state of an individual Order_Item — one of `active` or `cancelled`.
- **Cancellation**: The act of stopping fulfilment of an Order or a specific Order_Item before delivery.
- **Return**: The act of requesting a refund/return for a fully delivered Order.
- **Cancel_Reason**: An optional free-text string provided by the user when cancelling an Order or Order_Item.
- **Return_Reason**: A mandatory free-text string provided by the user when requesting a Return.
- **Invoice**: A PDF document summarising the Order details, items, pricing, and delivery address.
- **Delivery_Timeline**: A visual step-by-step progression showing the Order's journey through `Order Placed → Processing at Atelier → Shipped → Delivered`.
- **Stock**: The `stock` field on the `Variant` model, representing available inventory for a product variant.
- **Search_Query**: A user-supplied string used to filter orders by Display_Order_ID or product name.
- **Review**: A user-submitted rating and text feedback for a delivered Order_Item.
- **Profile_Sidebar**: The reusable `profile-sidebar.ejs` partial that renders the user avatar, name, membership tier, account navigation links, and logout button on the left column of account pages.

---

## Requirements

### Requirement 1: Human-Readable Order ID Generation

**User Story:** As a customer, I want to see a consistent, human-readable order ID (e.g. `#LX-88394-2024`) instead of a raw database ID, so that I can easily reference my order in communications.

#### Acceptance Criteria

1. THE Order_Management_System SHALL derive the Display_Order_ID from the Order's MongoDB ObjectId by extracting the last 5 decimal digits of the numeric representation of the ObjectId and combining them with the 4-digit year of order creation in the format `#LX-{5digits}-{year}`.
2. THE Order_Management_System SHALL display the Display_Order_ID consistently on the order listing page, order detail page, order confirmation page, and PDF invoice.
3. THE Order_Management_System SHALL ensure that the Display_Order_ID is read-only and is never stored as a separate field in the database.

---

### Requirement 2: Order Listing

**User Story:** As a customer, I want to see a paginated list of all my orders with their status and date, so that I can quickly review my purchase history.

#### Acceptance Criteria

1. WHEN a logged-in user navigates to `/orders`, THE Order_Management_System SHALL retrieve and display all Orders belonging to that user, sorted by creation date descending.
2. THE Order_Management_System SHALL display for each Order: the Display_Order_ID, Order_Status badge, order date, item thumbnail previews (up to 3), item count, payment method, and total amount.
3. WHEN an Order has more than 3 items, THE Order_Management_System SHALL display a `+N` overflow indicator showing the count of additional items beyond the first 3.
4. THE Order_Management_System SHALL render a status badge using a distinct colour per Order_Status value consistent with the existing badge styles in `orders.ejs`.
5. WHEN a user has no orders, THE Order_Management_System SHALL display an empty-state message with a link to the shop.

---

### Requirement 3: Order Search

**User Story:** As a customer, I want to search my orders by order ID or product name, so that I can quickly find a specific order without scrolling through my entire history.

#### Acceptance Criteria

1. WHEN a user submits a Search_Query on the orders page, THE Order_Management_System SHALL filter the displayed orders to those whose Display_Order_ID contains the Search_Query (case-insensitive) OR whose items contain at least one Order_Item with a `productName` that contains the Search_Query (case-insensitive).
2. WHEN a Search_Query returns no matching orders, THE Order_Management_System SHALL display a "No orders found" message with the submitted query.
3. WHEN a Search_Query is empty or cleared, THE Order_Management_System SHALL display the full unfiltered order list.
4. THE Order_Management_System SHALL preserve the Search_Query value in the search input field after the search is submitted.

---

### Requirement 4: Order Detail Page

**User Story:** As a customer, I want to view the full details of a specific order including items, pricing, delivery address, and payment information, so that I have a complete record of my purchase.

#### Acceptance Criteria

1. WHEN a logged-in user navigates to `/orders/:id`, THE Order_Management_System SHALL retrieve the Order by its MongoDB ObjectId and verify that the Order belongs to the authenticated user.
2. IF the Order does not belong to the authenticated user, THEN THE Order_Management_System SHALL redirect the user to `/orders` with a 403 status.
3. THE Order_Management_System SHALL display on the detail page: the Display_Order_ID, Order_Status badge, payment status badge, placed date and time, Delivery_Timeline, all Order_Items with their images and pricing, the order summary (subtotal, member discount if applicable, shipping, VAT, total), delivery address, and payment method.
4. THE Order_Management_System SHALL render the Delivery_Timeline as a sequential step indicator with four stages — `Order Placed`, `Processing at Atelier`, `Shipped`, `Delivered` — highlighting all stages up to and including the current Order_Status.
5. WHEN the Order_Status is `cancelled` or `returned`, THE Order_Management_System SHALL display the cancellation or return reason on the detail page.

---

### Requirement 5: Cancel Entire Order

**User Story:** As a customer, I want to cancel my entire order before it is shipped, so that I can change my mind without contacting support.

#### Acceptance Criteria

1. WHEN the Order_Status is `pending`, `confirmed`, or `processing`, THE Order_Management_System SHALL display a "Cancel Order" button on the order detail page.
2. WHEN a user submits a cancellation request via `POST /orders/:id/cancel`, THE Order_Management_System SHALL accept an optional `cancelReason` field in the request body.
3. WHEN a cancellation request is received for an Order with status `pending`, `confirmed`, or `processing`, THE Order_Management_System SHALL update the Order_Status to `cancelled`, store the Cancel_Reason (if provided), and increment the `stock` field on each active Order_Item's corresponding Variant by that item's `quantity`.
4. IF a cancellation request is received for an Order whose status is `shipped`, `delivered`, `cancelled`, or `returned`, THEN THE Order_Management_System SHALL return a 400 error response with a descriptive message.
5. WHEN the cancellation is successful, THE Order_Management_System SHALL redirect the user to the order detail page with a success notification.

---

### Requirement 6: Cancel Individual Order Item

**User Story:** As a customer, I want to cancel a specific item within my order without cancelling the whole order, so that I can keep the rest of my purchase.

#### Acceptance Criteria

1. WHEN the Order_Status is `pending`, `confirmed`, or `processing`, THE Order_Management_System SHALL display a per-item "Cancel Item" button for each Order_Item whose Item_Status is `active`.
2. THE Order_Management_System SHALL track Item_Status per Order_Item by adding a `status` field (values: `active`, `cancelled`) to the `orderItemSchema`.
3. WHEN a user submits an item cancellation request via `POST /orders/:id/items/:itemIndex/cancel`, THE Order_Management_System SHALL accept an optional `cancelReason` field in the request body.
4. WHEN an item cancellation request is received, THE Order_Management_System SHALL set the targeted Order_Item's `status` to `cancelled`, store the Cancel_Reason on the item (if provided), and increment the `stock` field on the corresponding Variant by the item's `quantity`.
5. WHEN all Order_Items in an Order are cancelled, THE Order_Management_System SHALL automatically update the Order_Status to `cancelled`.
6. WHEN at least one Order_Item remains `active` after an item cancellation, THE Order_Management_System SHALL recalculate and update the Order's `subtotal`, `tax`, and `total` to reflect only the active items.
7. IF an item cancellation request targets an Order_Item whose Item_Status is already `cancelled`, THEN THE Order_Management_System SHALL return a 400 error response with a descriptive message.

---

### Requirement 7: Return Order

**User Story:** As a customer, I want to request a return for my delivered order with a mandatory reason, so that I can initiate a refund process.

#### Acceptance Criteria

1. WHEN the Order_Status is `delivered`, THE Order_Management_System SHALL display a "Return Order" button on the order detail page.
2. WHEN a user submits a return request via `POST /orders/:id/return`, THE Order_Management_System SHALL require a non-empty `returnReason` field in the request body.
3. IF the `returnReason` field is absent or empty, THEN THE Order_Management_System SHALL return a 400 error response with the message "Return reason is required."
4. WHEN a valid return request is received for an Order with status `delivered`, THE Order_Management_System SHALL update the Order_Status to `returned` and store the `returnReason` in the `cancelReason` field.
5. IF a return request is received for an Order whose status is not `delivered`, THEN THE Order_Management_System SHALL return a 400 error response with a descriptive message.
6. WHEN the return request is successful, THE Order_Management_System SHALL redirect the user to the order detail page with a success notification.

---

### Requirement 8: Invoice Download

**User Story:** As a customer, I want to download a PDF invoice for my order, so that I have an official record for expense tracking or warranty purposes.

#### Acceptance Criteria

1. THE Order_Management_System SHALL display a "Download Invoice" button on the order detail page for all Orders regardless of status.
2. WHEN a user requests `GET /orders/:id/invoice`, THE Order_Management_System SHALL generate a PDF document containing: the Display_Order_ID, order date, all Order_Items (name, colour, quantity, unit price, item total), order summary (subtotal, shipping, tax, total), delivery address, and payment method.
3. THE Order_Management_System SHALL respond to the invoice request with the PDF as a downloadable file attachment with the filename `invoice-{Display_Order_ID}.pdf`.
4. WHEN the invoice request is for an Order that does not belong to the authenticated user, THE Order_Management_System SHALL return a 403 error response.
5. THE Order_Management_System SHALL generate the PDF server-side without requiring any client-side rendering.

---

### Requirement 9: Stock Restoration on Cancellation

**User Story:** As a store operator, I want stock to be automatically restored when an order or item is cancelled, so that inventory remains accurate.

#### Acceptance Criteria

1. WHEN an Order is cancelled (whole-order cancellation), THE Order_Management_System SHALL increment the `stock` field on each active Order_Item's Variant document by that item's `quantity` using an atomic database operation.
2. WHEN an individual Order_Item is cancelled, THE Order_Management_System SHALL increment the `stock` field on that item's Variant document by the item's `quantity` using an atomic database operation.
3. THE Order_Management_System SHALL perform stock restoration and order status update within the same logical operation to prevent partial updates.
4. IF a Variant document cannot be found during stock restoration, THEN THE Order_Management_System SHALL log the error and continue restoring stock for the remaining items.

---

### Requirement 10: Order Access Control

**User Story:** As a customer, I want my order data to be private, so that other users cannot view or modify my orders.

#### Acceptance Criteria

1. THE Order_Management_System SHALL require an authenticated session for all order-related routes (`/orders`, `/orders/:id`, `/orders/:id/cancel`, `/orders/:id/items/:itemIndex/cancel`, `/orders/:id/return`, `/orders/:id/invoice`).
2. WHEN an unauthenticated user accesses any order route, THE Order_Management_System SHALL redirect the user to the login page.
3. WHEN an authenticated user attempts to access or modify an Order that does not belong to them, THE Order_Management_System SHALL deny the request with a 403 response.

---

### Requirement 11: Profile Sidebar Layout on Orders Pages

**User Story:** As a customer, I want the orders pages to display the same profile sidebar as other account pages, so that I can navigate between my profile, orders, addresses, and other account sections without losing context.

#### Acceptance Criteria

1. THE Order_Management_System SHALL render the orders listing page (`/orders`) using a two-column grid layout — sidebar on the left (`lg:col-span-3`) and main content on the right (`lg:col-span-9`) — matching the layout pattern used on the profile and address pages.
2. THE Order_Management_System SHALL render the order detail page (`/orders/:id`) using the same two-column grid layout as the orders listing page.
3. THE Order_Management_System SHALL include the `profile-sidebar.ejs` partial in both the orders listing page and the order detail page via `<%- include('../partials/profile-sidebar') %>`.
4. WHEN a user is on any orders page (matching the path prefix `/orders`), THE Profile_Sidebar SHALL apply the active navigation style (`active-nav-item` class) to the "My Orders" link and display the blue indicator dot.
5. WHEN a user is on a non-orders page, THE Profile_Sidebar SHALL NOT apply the active navigation style to the "My Orders" link.
6. THE Profile_Sidebar SHALL include a "My Orders" navigation link pointing to `/orders`, positioned between the "Profile Details" link and the "My Addresses" link.
7. THE Profile_Sidebar SHALL include a "Wallet" navigation link and a "Refer & Earn" navigation link as additional entries below "My Addresses", consistent with the mockup navigation structure.
8. THE Order_Management_System SHALL pass the authenticated user object and a `path` local variable (set to the current route path, e.g. `/orders`) to the orders listing and order detail view templates so the sidebar can determine the active navigation item.
