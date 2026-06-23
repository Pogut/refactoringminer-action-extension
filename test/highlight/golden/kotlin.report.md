# Highlight report — kotlin

Feed: https://github.com/Pogut/rm-action-test/pull/12

21 refactorings · 21 painted · 60 cells

## [0] Change Attribute Access Modifier

| side | file | line | category | code |
|---|---|---|---|---|
| L | kotlin/CustomerProfile.kt | 6 | updated | `var loyaltyPoints: Int` |
| R | kotlin/CustomerProfile.kt | 6 | updated | `private var loyaltyPoints: Int` |

## [1] Encapsulate Attribute

| side | file | line | category | code |
|---|---|---|---|---|
| L | kotlin/CustomerProfile.kt | 6 | updated | `var loyaltyPoints: Int` |
| R | kotlin/CustomerProfile.kt | 6 | updated | `private var loyaltyPoints: Int` |
| R | kotlin/CustomerProfile.kt | 27 | inserted | `fun getLoyaltyPoints(): Int {` |
| R | kotlin/CustomerProfile.kt | 28 | inserted | `return loyaltyPoints` |
| R | kotlin/CustomerProfile.kt | 29 | inserted | `}` |

## [2] Invert Condition

| side | file | line | category | code |
|---|---|---|---|---|
| L | kotlin/CustomerProfile.kt | 13 | deleted | `if (optedIn && !bouncedEmail && purchaseCount > 0) {` |
| L | kotlin/CustomerProfile.kt | 14 | deleted | `return true` |
| L | kotlin/CustomerProfile.kt | 15 | deleted | `}` |
| R | kotlin/CustomerProfile.kt | 16 | inserted | `if (!emailOptedIn \|\| bouncedEmail \|\| purchaseCount <= 0) {` |
| R | kotlin/CustomerProfile.kt | 17 | inserted | `return false` |
| R | kotlin/CustomerProfile.kt | 18 | inserted | `}` |

## [3] Rename Parameter

| side | file | line | category | code |
|---|---|---|---|---|
| L | kotlin/CustomerProfile.kt | 12 | updated | `fun canReceivePromotion(optedIn: Boolean, bouncedEmail: Boolean, purchaseCount: Int): Boolean {` |
| L | kotlin/CustomerProfile.kt | 13 | deleted | `if (optedIn && !bouncedEmail && purchaseCount > 0) {` |
| L | kotlin/CustomerProfile.kt | 14 | deleted | `return true` |
| L | kotlin/CustomerProfile.kt | 15 | deleted | `}` |
| R | kotlin/CustomerProfile.kt | 15 | updated | `fun canReceivePromotion(emailOptedIn: Boolean, bouncedEmail: Boolean, purchaseCount: Int): Boolean {` |
| R | kotlin/CustomerProfile.kt | 16 | inserted | `if (!emailOptedIn \|\| bouncedEmail \|\| purchaseCount <= 0) {` |
| R | kotlin/CustomerProfile.kt | 17 | inserted | `return false` |
| R | kotlin/CustomerProfile.kt | 18 | inserted | `}` |

## [4] Rename Variable

| side | file | line | category | code |
|---|---|---|---|---|
| L | kotlin/CustomerProfile.kt | 20 | updated | `val points = amountCents / 100` |
| L | kotlin/CustomerProfile.kt | 21 | updated | `loyaltyPoints += points` |
| R | kotlin/CustomerProfile.kt | 23 | updated | `val earnedPoints = amountCents / 100` |
| R | kotlin/CustomerProfile.kt | 24 | updated | `loyaltyPoints += earnedPoints` |

## [5] Rename Method

| side | file | line | category | code |
|---|---|---|---|---|
| L | kotlin/OrderProcessor.kt | 30 | updated | `private fun formatPaymentStatus(total: Int, discount: Int): String {` |
| R | kotlin/OrderProcessor.kt | 29 | updated | `private fun describePaymentStatus(total: Int, discount: Int): String {` |

## [6] Inline Method

| side | file | line | category | code |
|---|---|---|---|---|
| L | kotlin/OrderProcessor.kt | 11 | deleted | `val dollars = centsToDollars(total)` |
| L | kotlin/OrderProcessor.kt | 27 | deleted | `return cents / 100.0` |
| R | kotlin/OrderProcessor.kt | 11 | inserted | `val dollars = total / 100.0` |

## [7] Extract Method

| side | file | line | category | code |
|---|---|---|---|---|
| L | kotlin/OrderProcessor.kt | 7 | updated | `val tax = (discountedSubtotal * taxRate).toInt()` |
| L | kotlin/OrderProcessor.kt | 8 | updated | `val total = discountedSubtotal + tax` |
| R | kotlin/OrderProcessor.kt | 5 | inserted | `val total = calculateTotal(unitPrice, quantity, discount)` |
| R | kotlin/OrderProcessor.kt | 22 | inserted | `private fun calculateTotal(unitPrice: Int, quantity: Int, discount: Int): Int {` |
| R | kotlin/OrderProcessor.kt | 23 | inserted | `val subtotal = unitPrice * quantity` |
| R | kotlin/OrderProcessor.kt | 24 | inserted | `val discountedSubtotal = subtotal - discount` |
| R | kotlin/OrderProcessor.kt | 25 | inserted | `val tax = (discountedSubtotal * PricingPolicy().taxRate).toInt()` |
| R | kotlin/OrderProcessor.kt | 26 | inserted | `return discountedSubtotal + tax` |
| R | kotlin/OrderProcessor.kt | 27 | inserted | `}` |

## [8] Rename Parameter

| side | file | line | category | code |
|---|---|---|---|---|
| L | kotlin/OrderProcessor.kt | 4 | updated | `fun buildReceipt(customerName: String, unitPrice: Int, quantity: Int, discount: Int): String {` |
| L | kotlin/OrderProcessor.kt | 10 | updated | `val header = formatHeader(customerName)` |
| R | kotlin/OrderProcessor.kt | 4 | updated | `fun buildReceipt(buyerName: String, unitPrice: Int, quantity: Int, discount: Int): String {` |
| R | kotlin/OrderProcessor.kt | 10 | updated | `val header = formatter.createReceiptHeader(buyerName)` |

## [9] Pull Up Method

| side | file | line | category | code |
|---|---|---|---|---|
| L | kotlin/GuestAccount.kt | 2 | movedOut | `fun displayName(): String {` |
| R | kotlin/Account.kt | 2 | movedIn | `open fun displayName(): String {` |

## [10] Pull Up Attribute

| side | file | line | category | code |
|---|---|---|---|---|
| L | kotlin/GuestAccount.kt | 1 | movedOut | `class GuestAccount(private val username: String) {` |
| R | kotlin/Account.kt | 1 | movedIn | `open class Account(protected val username: String) {` |

## [11] Change Attribute Access Modifier

| side | file | line | category | code |
|---|---|---|---|---|
| L | kotlin/GuestAccount.kt | 1 | movedOut | `class GuestAccount(private val username: String) {` |
| R | kotlin/Account.kt | 1 | movedIn | `open class Account(protected val username: String) {` |

## [12] Change Attribute Access Modifier

| side | file | line | category | code |
|---|---|---|---|---|
| L | kotlin/AdminAccount.kt | 1 | updated | `class AdminAccount(private val username: String) {` |
| R | kotlin/Account.kt | 1 | movedIn | `open class Account(protected val username: String) {` |

## [13] Extract Superclass

| side | file | line | category | code |
|---|---|---|---|---|
| L | AdminAccount.java | 1 | updated | `public class AdminAccount {` |
| L | kotlin/GuestAccount.kt | 1 | movedOut | `class GuestAccount(private val username: String) {` |
| R | AdminAccount.java | 1 | inserted | `public class AdminAccount {` |
| R | kotlin/Account.kt | 1 | movedIn | `open class Account(protected val username: String) {` |
| R | kotlin/Account.kt | 2 | movedIn | `open fun displayName(): String {` |
| R | kotlin/Account.kt | 3 | inserted | `return username.trim().uppercase()` |
| R | kotlin/Account.kt | 4 | inserted | `}` |
| R | kotlin/Account.kt | 5 | inserted | `}` |
| R | kotlin/GuestAccount.kt | 1 | inserted | `class GuestAccount(username: String) : Account(username) {` |

## [14] Move Attribute

| side | file | line | category | code |
|---|---|---|---|---|
| L | kotlin/CustomerProfile.kt | 3 | movedOut | `private val street: String,` |
| R | kotlin/Address.kt | 2 | movedIn | `private val street: String,` |

## [15] Move Attribute

| side | file | line | category | code |
|---|---|---|---|---|
| L | kotlin/CustomerProfile.kt | 4 | movedOut | `private val city: String,` |
| R | kotlin/Address.kt | 3 | movedIn | `private val city: String,` |

## [16] Move Attribute

| side | file | line | category | code |
|---|---|---|---|---|
| L | kotlin/CustomerProfile.kt | 5 | movedOut | `private val postalCode: String,` |
| R | kotlin/Address.kt | 4 | movedIn | `private val postalCode: String` |

## [17] Extract Class

| side | file | line | category | code |
|---|---|---|---|---|
| L | kotlin/CustomerProfile.kt | 3 | movedOut | `private val street: String,` |
| L | kotlin/CustomerProfile.kt | 4 | movedOut | `private val city: String,` |
| L | kotlin/CustomerProfile.kt | 5 | movedOut | `private val postalCode: String,` |
| R | kotlin/Address.kt | 1 | inserted | `class Address(` |
| R | kotlin/Address.kt | 2 | movedIn | `private val street: String,` |
| R | kotlin/Address.kt | 3 | movedIn | `private val city: String,` |
| R | kotlin/Address.kt | 4 | movedIn | `private val postalCode: String` |
| R | kotlin/Address.kt | 5 | inserted | `) {` |
| R | kotlin/Address.kt | 6 | inserted | `fun format(): String {` |
| R | kotlin/Address.kt | 7 | inserted | `return "$street\n$city $postalCode"` |
| R | kotlin/Address.kt | 8 | inserted | `}` |
| R | kotlin/Address.kt | 9 | inserted | `}` |

## [18] Change Method Access Modifier

| side | file | line | category | code |
|---|---|---|---|---|
| L | kotlin/OrderProcessor.kt | 22 | updated | `private fun formatHeader(customerName: String): String {` |
| R | kotlin/ReceiptFormatter.kt | 2 | updated | `fun createReceiptHeader(customerName: String): String {` |

## [19] Move And Rename Method

| side | file | line | category | code |
|---|---|---|---|---|
| L | kotlin/OrderProcessor.kt | 22 | updated | `private fun formatHeader(customerName: String): String {` |
| R | kotlin/ReceiptFormatter.kt | 2 | updated | `fun createReceiptHeader(customerName: String): String {` |

## [20] Move Attribute

| side | file | line | category | code |
|---|---|---|---|---|
| L | kotlin/AdminAccount.kt | 1 | updated | `class AdminAccount(private val username: String) {` |
| R | kotlin/Account.kt | 1 | movedIn | `open class Account(protected val username: String) {` |
