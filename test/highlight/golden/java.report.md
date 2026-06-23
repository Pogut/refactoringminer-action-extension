# Highlight report — java

Feed: https://github.com/Pogut/rm-action-test/pull/9

22 refactorings · 22 painted · 74 cells

## [0] Change Attribute Access Modifier

| side | file | line | category | code |
|---|---|---|---|---|
| L | CustomerProfile.java | 6 | updated | `public int loyaltyPoints;` |
| R | CustomerProfile.java | 4 | updated | `private int loyaltyPoints;` |

## [1] Encapsulate Attribute

| side | file | line | category | code |
|---|---|---|---|---|
| L | CustomerProfile.java | 6 | updated | `public int loyaltyPoints;` |
| R | CustomerProfile.java | 4 | updated | `private int loyaltyPoints;` |
| R | CustomerProfile.java | 28 | inserted | `public int getLoyaltyPoints() {` |
| R | CustomerProfile.java | 29 | inserted | `return loyaltyPoints;` |
| R | CustomerProfile.java | 30 | inserted | `}` |

## [2] Invert Condition

| side | file | line | category | code |
|---|---|---|---|---|
| L | CustomerProfile.java | 21 | deleted | `if (optedIn && !bouncedEmail && purchaseCount > 0) {` |
| L | CustomerProfile.java | 22 | deleted | `return true;` |
| L | CustomerProfile.java | 23 | deleted | `}` |
| R | CustomerProfile.java | 17 | inserted | `if (!emailOptedIn \|\| bouncedEmail \|\| purchaseCount <= 0) {` |
| R | CustomerProfile.java | 18 | inserted | `return false;` |
| R | CustomerProfile.java | 19 | inserted | `}` |

## [3] Rename Parameter

| side | file | line | category | code |
|---|---|---|---|---|
| L | CustomerProfile.java | 20 | updated | `public boolean canReceivePromotion(boolean optedIn, boolean bouncedEmail, int purchaseCount) {` |
| L | CustomerProfile.java | 21 | deleted | `if (optedIn && !bouncedEmail && purchaseCount > 0) {` |
| L | CustomerProfile.java | 22 | deleted | `return true;` |
| L | CustomerProfile.java | 23 | deleted | `}` |
| R | CustomerProfile.java | 16 | updated | `public boolean canReceivePromotion(boolean emailOptedIn, boolean bouncedEmail, int purchaseCount) {` |
| R | CustomerProfile.java | 17 | inserted | `if (!emailOptedIn \|\| bouncedEmail \|\| purchaseCount <= 0) {` |
| R | CustomerProfile.java | 18 | inserted | `return false;` |
| R | CustomerProfile.java | 19 | inserted | `}` |

## [4] Rename Variable

| side | file | line | category | code |
|---|---|---|---|---|
| L | CustomerProfile.java | 28 | updated | `int points = amountCents / 100;` |
| L | CustomerProfile.java | 29 | updated | `loyaltyPoints += points;` |
| R | CustomerProfile.java | 24 | updated | `int earnedPoints = amountCents / 100;` |
| R | CustomerProfile.java | 25 | updated | `loyaltyPoints += earnedPoints;` |

## [5] Rename Attribute

| side | file | line | category | code |
|---|---|---|---|---|
| L | CustomerProfile.java | 2 | updated | `private String fullName;` |
| R | CustomerProfile.java | 2 | updated | `private String displayName;` |

## [6] Rename Method

| side | file | line | category | code |
|---|---|---|---|---|
| L | OrderProcessor.java | 30 | updated | `private String formatPaymentStatus(int total, int discount) {` |
| R | OrderProcessor.java | 29 | updated | `private String describePaymentStatus(int total, int discount) {` |

## [7] Inline Method

| side | file | line | category | code |
|---|---|---|---|---|
| L | OrderProcessor.java | 11 | deleted | `double dollars = centsToDollars(total);` |
| L | OrderProcessor.java | 27 | deleted | `return cents / 100.0;` |
| R | OrderProcessor.java | 11 | inserted | `double dollars = total / 100.0;` |

## [8] Extract Method

| side | file | line | category | code |
|---|---|---|---|---|
| L | OrderProcessor.java | 7 | updated | `int tax = (int) (discountedSubtotal * taxRate);` |
| L | OrderProcessor.java | 8 | updated | `int total = discountedSubtotal + tax;` |
| R | OrderProcessor.java | 5 | inserted | `int total = calculateTotal(unitPrice, quantity, discount);` |
| R | OrderProcessor.java | 22 | inserted | `private int calculateTotal(int unitPrice, int quantity, int discount) {` |
| R | OrderProcessor.java | 23 | inserted | `int subtotal = unitPrice * quantity;` |
| R | OrderProcessor.java | 24 | inserted | `int discountedSubtotal = subtotal - discount;` |
| R | OrderProcessor.java | 25 | inserted | `int tax = (int) (discountedSubtotal * new PricingPolicy().taxRate);` |
| R | OrderProcessor.java | 26 | inserted | `return discountedSubtotal + tax;` |
| R | OrderProcessor.java | 27 | inserted | `}` |

## [9] Rename Parameter

| side | file | line | category | code |
|---|---|---|---|---|
| L | OrderProcessor.java | 4 | updated | `public String buildReceipt(String customerName, int unitPrice, int quantity, int discount) {` |
| L | OrderProcessor.java | 10 | updated | `String header = formatHeader(customerName);` |
| R | OrderProcessor.java | 4 | updated | `public String buildReceipt(String buyerName, int unitPrice, int quantity, int discount) {` |
| R | OrderProcessor.java | 10 | updated | `String header = formatter.createReceiptHeader(buyerName);` |

## [10] Pull Up Method

| side | file | line | category | code |
|---|---|---|---|---|
| L | AdminAccount.java | 9 | movedOut | `public String displayName() {` |
| R | Account.java | 8 | movedIn | `public String displayName() {` |

## [11] Pull Up Attribute

| side | file | line | category | code |
|---|---|---|---|---|
| L | AdminAccount.java | 2 | movedOut | `protected String username;` |
| R | Account.java | 2 | movedIn | `protected String username;` |

## [12] Pull Up Method

| side | file | line | category | code |
|---|---|---|---|---|
| L | GuestAccount.java | 8 | movedOut | `public String displayName() {` |
| R | Account.java | 8 | movedIn | `public String displayName() {` |

## [13] Pull Up Attribute

| side | file | line | category | code |
|---|---|---|---|---|
| L | GuestAccount.java | 2 | movedOut | `protected String username;` |
| R | Account.java | 2 | movedIn | `protected String username;` |

## [14] Extract Superclass

| side | file | line | category | code |
|---|---|---|---|---|
| L | AdminAccount.java | 1 | updated | `public class AdminAccount {` |
| L | GuestAccount.java | 1 | updated | `public class GuestAccount {` |
| R | Account.java | 1 | inserted | `public class Account {` |
| R | Account.java | 2 | movedIn | `protected String username;` |
| R | Account.java | 4 | inserted | `public Account(String username) {` |
| R | Account.java | 5 | inserted | `this.username = username;` |
| R | Account.java | 6 | inserted | `}` |
| R | Account.java | 8 | movedIn | `public String displayName() {` |
| R | Account.java | 9 | inserted | `return username.trim().toUpperCase();` |
| R | Account.java | 10 | inserted | `}` |
| R | Account.java | 11 | inserted | `}` |
| R | AdminAccount.java | 1 | inserted | `public class AdminAccount extends Account {` |
| R | GuestAccount.java | 1 | inserted | `public class GuestAccount extends Account {` |

## [15] Move Attribute

| side | file | line | category | code |
|---|---|---|---|---|
| L | CustomerProfile.java | 3 | movedOut | `private String street;` |
| R | Address.java | 2 | movedIn | `private String street;` |

## [16] Move Attribute

| side | file | line | category | code |
|---|---|---|---|---|
| L | CustomerProfile.java | 4 | movedOut | `private String city;` |
| R | Address.java | 3 | movedIn | `private String city;` |

## [17] Move Attribute

| side | file | line | category | code |
|---|---|---|---|---|
| L | CustomerProfile.java | 5 | movedOut | `private String postalCode;` |
| R | Address.java | 4 | movedIn | `private String postalCode;` |

## [18] Extract Class

| side | file | line | category | code |
|---|---|---|---|---|
| L | CustomerProfile.java | 3 | movedOut | `private String street;` |
| L | CustomerProfile.java | 4 | movedOut | `private String city;` |
| L | CustomerProfile.java | 5 | movedOut | `private String postalCode;` |
| R | Address.java | 1 | inserted | `public class Address {` |
| R | Address.java | 2 | movedIn | `private String street;` |
| R | Address.java | 3 | movedIn | `private String city;` |
| R | Address.java | 4 | movedIn | `private String postalCode;` |
| R | Address.java | 6 | inserted | `public Address(String street, String city, String postalCode) {` |
| R | Address.java | 7 | inserted | `this.street = street;` |
| R | Address.java | 8 | inserted | `this.city = city;` |
| R | Address.java | 9 | inserted | `this.postalCode = postalCode;` |
| R | Address.java | 10 | inserted | `}` |
| R | Address.java | 12 | inserted | `public String format() {` |
| R | Address.java | 13 | inserted | `return street + "\n" + city + " " + postalCode;` |
| R | Address.java | 14 | inserted | `}` |
| R | Address.java | 15 | inserted | `}` |

## [19] Change Method Access Modifier

| side | file | line | category | code |
|---|---|---|---|---|
| L | OrderProcessor.java | 22 | updated | `private String formatHeader(String customerName) {` |
| R | ReceiptFormatter.java | 2 | updated | `public String createReceiptHeader(String customerName) {` |

## [20] Move And Rename Method

| side | file | line | category | code |
|---|---|---|---|---|
| L | OrderProcessor.java | 22 | updated | `private String formatHeader(String customerName) {` |
| R | ReceiptFormatter.java | 2 | updated | `public String createReceiptHeader(String customerName) {` |

## [21] Extract And Move Method

| side | file | line | category | code |
|---|---|---|---|---|
| L | CustomerProfile.java | 17 | updated | `return fullName + "\n" + street + "\n" + city + " " + postalCode;` |
| R | Address.java | 12 | inserted | `public String format() {` |
| R | Address.java | 13 | inserted | `return street + "\n" + city + " " + postalCode;` |
| R | Address.java | 14 | inserted | `}` |
| R | CustomerProfile.java | 13 | inserted | `return displayName + "\n" + address.format();` |
