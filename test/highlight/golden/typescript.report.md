# Highlight report — typescript

Feed: https://github.com/Pogut/rm-action-test/pull/13

22 refactorings · 22 painted · 68 cells

## [0] Change Attribute Access Modifier

| side | file | line | category | code |
|---|---|---|---|---|
| L | typescript/CustomerProfile.ts | 6 | updated | `public loyaltyPoints: number;` |
| R | typescript/CustomerProfile.ts | 6 | updated | `private loyaltyPoints: number;` |

## [1] Invert Condition

| side | file | line | category | code |
|---|---|---|---|---|
| L | typescript/CustomerProfile.ts | 21 | deleted | `if (optedIn && !bouncedEmail && purchaseCount > 0) {` |
| L | typescript/CustomerProfile.ts | 22 | deleted | `return true;` |
| L | typescript/CustomerProfile.ts | 23 | deleted | `}` |
| R | typescript/CustomerProfile.ts | 19 | inserted | `if (!emailOptedIn \|\| bouncedEmail \|\| purchaseCount <= 0) {` |
| R | typescript/CustomerProfile.ts | 20 | inserted | `return false;` |
| R | typescript/CustomerProfile.ts | 21 | inserted | `}` |

## [2] Rename Parameter

| side | file | line | category | code |
|---|---|---|---|---|
| L | typescript/CustomerProfile.ts | 20 | updated | `canReceivePromotion(optedIn: boolean, bouncedEmail: boolean, purchaseCount: number): boolean {` |
| L | typescript/CustomerProfile.ts | 21 | deleted | `if (optedIn && !bouncedEmail && purchaseCount > 0) {` |
| L | typescript/CustomerProfile.ts | 22 | deleted | `return true;` |
| L | typescript/CustomerProfile.ts | 23 | deleted | `}` |
| R | typescript/CustomerProfile.ts | 18 | updated | `canReceivePromotion(emailOptedIn: boolean, bouncedEmail: boolean, purchaseCount: number): boolean {` |
| R | typescript/CustomerProfile.ts | 19 | inserted | `if (!emailOptedIn \|\| bouncedEmail \|\| purchaseCount <= 0) {` |
| R | typescript/CustomerProfile.ts | 20 | inserted | `return false;` |
| R | typescript/CustomerProfile.ts | 21 | inserted | `}` |

## [3] Rename Variable

| side | file | line | category | code |
|---|---|---|---|---|
| L | typescript/CustomerProfile.ts | 28 | updated | `const points = Math.floor(amountCents / 100);` |
| L | typescript/CustomerProfile.ts | 29 | updated | `this.loyaltyPoints += points;` |
| R | typescript/CustomerProfile.ts | 26 | updated | `const earnedPoints = Math.floor(amountCents / 100);` |
| R | typescript/CustomerProfile.ts | 27 | updated | `this.loyaltyPoints += earnedPoints;` |

## [4] Rename Method

| side | file | line | category | code |
|---|---|---|---|---|
| L | typescript/OrderProcessor.ts | 32 | updated | `private formatPaymentStatus(total: number, discount: number): string {` |
| R | typescript/OrderProcessor.ts | 34 | updated | `private describePaymentStatus(total: number, discount: number): string {` |

## [5] Inline Method

| side | file | line | category | code |
|---|---|---|---|---|
| L | typescript/OrderProcessor.ts | 11 | deleted | `const dollars = this.centsToDollars(total);` |
| L | typescript/OrderProcessor.ts | 29 | deleted | `return cents / 100.0;` |
| R | typescript/OrderProcessor.ts | 14 | inserted | `const dollars = total / 100.0;` |

## [6] Extract Method

| side | file | line | category | code |
|---|---|---|---|---|
| L | typescript/OrderProcessor.ts | 7 | updated | `const tax = Math.floor(discountedSubtotal * this.taxRate);` |
| L | typescript/OrderProcessor.ts | 8 | updated | `const total = discountedSubtotal + tax;` |
| R | typescript/OrderProcessor.ts | 8 | inserted | `const total = this.calculateTotal(unitPrice, quantity, discount);` |
| R | typescript/OrderProcessor.ts | 27 | inserted | `private calculateTotal(unitPrice: number, quantity: number, discount: number): number {` |
| R | typescript/OrderProcessor.ts | 28 | inserted | `const subtotal = unitPrice * quantity;` |
| R | typescript/OrderProcessor.ts | 29 | inserted | `const discountedSubtotal = subtotal - discount;` |
| R | typescript/OrderProcessor.ts | 30 | inserted | `const tax = Math.floor(discountedSubtotal * new PricingPolicy().taxRate);` |
| R | typescript/OrderProcessor.ts | 31 | inserted | `return discountedSubtotal + tax;` |
| R | typescript/OrderProcessor.ts | 32 | inserted | `}` |

## [7] Rename Parameter

| side | file | line | category | code |
|---|---|---|---|---|
| L | typescript/OrderProcessor.ts | 4 | updated | `buildReceipt(customerName: string, unitPrice: number, quantity: number, discount: number): string {` |
| L | typescript/OrderProcessor.ts | 10 | updated | `const header = this.formatHeader(customerName);` |
| R | typescript/OrderProcessor.ts | 7 | updated | `buildReceipt(buyerName: string, unitPrice: number, quantity: number, discount: number): string {` |
| R | typescript/OrderProcessor.ts | 13 | updated | `const header = this.formatter.createReceiptHeader(buyerName);` |

## [8] Pull Up Method

| side | file | line | category | code |
|---|---|---|---|---|
| L | typescript/AdminAccount.ts | 9 | movedOut | `displayName(): string {` |
| R | typescript/Account.ts | 8 | movedIn | `displayName(): string {` |

## [9] Pull Up Attribute

| side | file | line | category | code |
|---|---|---|---|---|
| L | typescript/AdminAccount.ts | 2 | movedOut | `protected username: string;` |
| R | typescript/Account.ts | 2 | movedIn | `protected username: string;` |

## [10] Pull Up Method

| side | file | line | category | code |
|---|---|---|---|---|
| L | typescript/GuestAccount.ts | 8 | movedOut | `displayName(): string {` |
| R | typescript/Account.ts | 8 | movedIn | `displayName(): string {` |

## [11] Pull Up Attribute

| side | file | line | category | code |
|---|---|---|---|---|
| L | typescript/GuestAccount.ts | 2 | movedOut | `protected username: string;` |
| R | typescript/Account.ts | 2 | movedIn | `protected username: string;` |

## [12] Move Attribute

| side | file | line | category | code |
|---|---|---|---|---|
| L | typescript/CustomerProfile.ts | 3 | movedOut | `private street: string;` |
| R | typescript/Address.ts | 2 | movedIn | `private street: string;` |

## [13] Move Attribute

| side | file | line | category | code |
|---|---|---|---|---|
| L | typescript/CustomerProfile.ts | 4 | movedOut | `private city: string;` |
| R | typescript/Address.ts | 3 | movedIn | `private city: string;` |

## [14] Move Attribute

| side | file | line | category | code |
|---|---|---|---|---|
| L | typescript/CustomerProfile.ts | 5 | movedOut | `private postalCode: string;` |
| R | typescript/Address.ts | 4 | movedIn | `private postalCode: string;` |

## [15] Extract Superclass

| side | file | line | category | code |
|---|---|---|---|---|
| L | typescript/AdminAccount.ts | 2 | movedOut | `protected username: string;` |
| R | typescript/Account.ts | 1 | inserted | `export class Account {` |
| R | typescript/Account.ts | 2 | movedIn | `protected username: string;` |
| R | typescript/Account.ts | 4 | inserted | `constructor(username: string) {` |
| R | typescript/Account.ts | 5 | inserted | `this.username = username;` |
| R | typescript/Account.ts | 6 | inserted | `}` |
| R | typescript/Account.ts | 8 | movedIn | `displayName(): string {` |
| R | typescript/Account.ts | 9 | inserted | `return this.username.trim().toUpperCase();` |
| R | typescript/Account.ts | 10 | inserted | `}` |
| R | typescript/Account.ts | 11 | inserted | `}` |

## [16] Extract Superclass

| side | file | line | category | code |
|---|---|---|---|---|
| L | typescript/GuestAccount.ts | 2 | movedOut | `protected username: string;` |
| R | typescript/Account.ts | 1 | inserted | `export class Account {` |
| R | typescript/Account.ts | 2 | movedIn | `protected username: string;` |
| R | typescript/Account.ts | 4 | inserted | `constructor(username: string) {` |
| R | typescript/Account.ts | 5 | inserted | `this.username = username;` |
| R | typescript/Account.ts | 6 | inserted | `}` |
| R | typescript/Account.ts | 8 | movedIn | `displayName(): string {` |
| R | typescript/Account.ts | 9 | inserted | `return this.username.trim().toUpperCase();` |
| R | typescript/Account.ts | 10 | inserted | `}` |
| R | typescript/Account.ts | 11 | inserted | `}` |

## [17] Extract Class

| side | file | line | category | code |
|---|---|---|---|---|
| L | typescript/CustomerProfile.ts | 3 | movedOut | `private street: string;` |
| L | typescript/CustomerProfile.ts | 4 | movedOut | `private city: string;` |
| L | typescript/CustomerProfile.ts | 5 | movedOut | `private postalCode: string;` |
| R | typescript/Address.ts | 1 | inserted | `export class Address {` |
| R | typescript/Address.ts | 2 | movedIn | `private street: string;` |
| R | typescript/Address.ts | 3 | movedIn | `private city: string;` |
| R | typescript/Address.ts | 4 | movedIn | `private postalCode: string;` |
| R | typescript/Address.ts | 6 | inserted | `constructor(street: string, city: string, postalCode: string) {` |
| R | typescript/Address.ts | 7 | inserted | `this.street = street;` |
| R | typescript/Address.ts | 8 | inserted | `this.city = city;` |
| R | typescript/Address.ts | 9 | inserted | `this.postalCode = postalCode;` |
| R | typescript/Address.ts | 10 | inserted | `}` |
| R | typescript/Address.ts | 12 | inserted | `format(): string {` |
| R | typescript/Address.ts | 13 | inserted | `return `${this.street}\n${this.city} ${this.postalCode}`;` |
| R | typescript/Address.ts | 14 | inserted | `}` |
| R | typescript/Address.ts | 15 | inserted | `}` |

## [18] Move And Rename Method

| side | file | line | category | code |
|---|---|---|---|---|
| L | typescript/OrderProcessor.ts | 24 | movedOut | `private formatHeader(customerName: string): string {` |
| R | typescript/ReceiptFormatter.ts | 2 | movedIn | `createReceiptHeader(customerName: string): string {` |

## [19] Move Code

| side | file | line | category | code |
|---|---|---|---|---|
| L | typescript/AdminAccount.ts | 6 | movedOut | `this.username = username;` |
| R | typescript/Account.ts | 5 | inserted | `this.username = username;` |

## [20] Move Code

| side | file | line | category | code |
|---|---|---|---|---|
| L | typescript/CustomerProfile.ts | 9 | movedOut | `this.fullName = fullName;` |
| L | typescript/CustomerProfile.ts | 10 | movedOut | `this.street = street;` |
| L | typescript/CustomerProfile.ts | 12 | movedOut | `this.postalCode = postalCode;` |
| R | typescript/Address.ts | 7 | inserted | `this.street = street;` |
| R | typescript/Address.ts | 8 | inserted | `this.city = city;` |
| R | typescript/Address.ts | 9 | inserted | `this.postalCode = postalCode;` |

## [21] Move Code

| side | file | line | category | code |
|---|---|---|---|---|
| L | typescript/GuestAccount.ts | 5 | movedOut | `this.username = username;` |
| R | typescript/Account.ts | 5 | inserted | `this.username = username;` |
