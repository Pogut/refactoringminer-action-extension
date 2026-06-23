# Highlight report — python

Feed: https://github.com/Pogut/rm-action-test/pull/14

26 refactorings · 26 painted · 66 cells

## [0] Rename Attribute

| side | file | line | category | code |
|---|---|---|---|---|
| L | python/customer_profile.py | 3 | updated | `self._full_name = full_name` |
| R | python/customer_profile.py | 6 | updated | `self._display_name = full_name` |

## [1] Rename Attribute

| side | file | line | category | code |
|---|---|---|---|---|
| L | python/customer_profile.py | 7 | updated | `self.loyalty_points = loyalty_points` |
| R | python/customer_profile.py | 8 | updated | `self._loyalty_points = loyalty_points` |

## [2] Encapsulate Attribute

| side | file | line | category | code |
|---|---|---|---|---|
| L | python/customer_profile.py | 7 | updated | `self.loyalty_points = loyalty_points` |
| R | python/customer_profile.py | 8 | updated | `self._loyalty_points = loyalty_points` |
| R | python/customer_profile.py | 22 | inserted | `def get_loyalty_points(self):` |
| R | python/customer_profile.py | 23 | inserted | `return self._loyalty_points` |

## [3] Invert Condition

| side | file | line | category | code |
|---|---|---|---|---|
| L | python/customer_profile.py | 13 | deleted | `if opted_in and not bounced_email and purchase_count > 0:` |
| L | python/customer_profile.py | 14 | deleted | `return True` |
| L | python/customer_profile.py | 15 | deleted | `return False` |
| R | python/customer_profile.py | 14 | inserted | `if not email_opted_in or bounced_email or purchase_count <= 0:` |
| R | python/customer_profile.py | 15 | inserted | `return False` |
| R | python/customer_profile.py | 16 | inserted | `return True` |

## [4] Rename Parameter

| side | file | line | category | code |
|---|---|---|---|---|
| L | python/customer_profile.py | 12 | updated | `def can_receive_promotion(self, opted_in, bounced_email, purchase_count):` |
| L | python/customer_profile.py | 13 | deleted | `if opted_in and not bounced_email and purchase_count > 0:` |
| L | python/customer_profile.py | 14 | deleted | `return True` |
| L | python/customer_profile.py | 15 | deleted | `return False` |
| R | python/customer_profile.py | 13 | updated | `def can_receive_promotion(self, email_opted_in, bounced_email, purchase_count):` |
| R | python/customer_profile.py | 14 | inserted | `if not email_opted_in or bounced_email or purchase_count <= 0:` |
| R | python/customer_profile.py | 15 | inserted | `return False` |
| R | python/customer_profile.py | 16 | inserted | `return True` |

## [5] Rename Variable

| side | file | line | category | code |
|---|---|---|---|---|
| L | python/customer_profile.py | 18 | updated | `points = amount_cents // 100` |
| L | python/customer_profile.py | 19 | updated | `self.loyalty_points += points` |
| R | python/customer_profile.py | 19 | updated | `earned_points = amount_cents // 100` |
| R | python/customer_profile.py | 20 | updated | `self._loyalty_points += earned_points` |

## [6] Rename Method

| side | file | line | category | code |
|---|---|---|---|---|
| L | python/order_processor.py | 30 | updated | `def _format_payment_status(self, total, discount):` |
| R | python/order_processor.py | 34 | updated | `def _describe_payment_status(self, total, discount):` |

## [7] Inline Method

| side | file | line | category | code |
|---|---|---|---|---|
| L | python/order_processor.py | 12 | deleted | `dollars = self._cents_to_dollars(total)` |
| L | python/order_processor.py | 28 | deleted | `return cents / 100.0` |
| R | python/order_processor.py | 16 | inserted | `dollars = total / 100.0` |

## [8] Extract Method

| side | file | line | category | code |
|---|---|---|---|---|
| L | python/order_processor.py | 8 | updated | `tax = int(discounted_subtotal * self._tax_rate)` |
| L | python/order_processor.py | 9 | updated | `total = discounted_subtotal + tax` |
| R | python/order_processor.py | 10 | inserted | `total = self._calculate_total(unit_price, quantity, discount)` |
| R | python/order_processor.py | 28 | inserted | `def _calculate_total(self, unit_price, quantity, discount):` |
| R | python/order_processor.py | 29 | inserted | `subtotal = unit_price * quantity` |
| R | python/order_processor.py | 30 | inserted | `discounted_subtotal = subtotal - discount` |
| R | python/order_processor.py | 31 | inserted | `tax = int(discounted_subtotal * PricingPolicy().tax_rate)` |
| R | python/order_processor.py | 32 | inserted | `return discounted_subtotal + tax` |

## [9] Rename Parameter

| side | file | line | category | code |
|---|---|---|---|---|
| L | python/order_processor.py | 5 | updated | `def build_receipt(self, customer_name, unit_price, quantity, discount):` |
| L | python/order_processor.py | 11 | updated | `header = self._format_header(customer_name)` |
| R | python/order_processor.py | 9 | updated | `def build_receipt(self, buyer_name, unit_price, quantity, discount):` |
| R | python/order_processor.py | 15 | updated | `header = self._formatter.create_receipt_header(buyer_name)` |

## [10] Pull Up Method

| side | file | line | category | code |
|---|---|---|---|---|
| L | python/admin_account.py | 6 | movedOut | `def display_name(self):` |
| R | python/account.py | 5 | movedIn | `def display_name(self):` |

## [11] Pull Up Attribute

| side | file | line | category | code |
|---|---|---|---|---|
| L | python/admin_account.py | 3 | movedOut | `self._username = username` |
| R | python/account.py | 3 | movedIn | `self._username = username` |

## [12] Pull Up Method

| side | file | line | category | code |
|---|---|---|---|---|
| L | python/guest_account.py | 5 | movedOut | `def display_name(self):` |
| R | python/account.py | 5 | movedIn | `def display_name(self):` |

## [13] Pull Up Attribute

| side | file | line | category | code |
|---|---|---|---|---|
| L | python/guest_account.py | 3 | movedOut | `self._username = username` |
| R | python/account.py | 3 | movedIn | `self._username = username` |

## [14] Extract Superclass

| side | file | line | category | code |
|---|---|---|---|---|
| L | python/admin_account.py | 1 | updated | `class AdminAccount:` |
| L | python/guest_account.py | 1 | updated | `class GuestAccount:` |
| R | python/account.py | 1 | inserted | `class Account:` |
| R | python/account.py | 2 | inserted | `def __init__(self, username):` |
| R | python/account.py | 3 | movedIn | `self._username = username` |
| R | python/account.py | 5 | movedIn | `def display_name(self):` |
| R | python/account.py | 6 | inserted | `return self._username.strip().upper()` |
| R | python/account.py | 7 | inserted | `#test commit 2 22 222` |
| R | python/admin_account.py | 4 | inserted | `class AdminAccount(Account):` |
| R | python/guest_account.py | 4 | inserted | `class GuestAccount(Account):` |

## [15] Move Attribute

| side | file | line | category | code |
|---|---|---|---|---|
| L | python/customer_profile.py | 4 | movedOut | `self._street = street` |
| R | python/address.py | 3 | movedIn | `self._street = street` |

## [16] Move Attribute

| side | file | line | category | code |
|---|---|---|---|---|
| L | python/customer_profile.py | 5 | movedOut | `self._city = city` |
| R | python/address.py | 4 | movedIn | `self._city = city` |

## [17] Move Attribute

| side | file | line | category | code |
|---|---|---|---|---|
| L | python/customer_profile.py | 6 | movedOut | `self._postal_code = postal_code` |
| R | python/address.py | 5 | movedIn | `self._postal_code = postal_code` |

## [18] Extract Class

| side | file | line | category | code |
|---|---|---|---|---|
| L | python/customer_profile.py | 4 | movedOut | `self._street = street` |
| L | python/customer_profile.py | 5 | movedOut | `self._city = city` |
| L | python/customer_profile.py | 6 | movedOut | `self._postal_code = postal_code` |
| R | python/address.py | 1 | inserted | `class Address:` |
| R | python/address.py | 2 | inserted | `def __init__(self, street, city, postal_code):` |
| R | python/address.py | 3 | movedIn | `self._street = street` |
| R | python/address.py | 4 | movedIn | `self._city = city` |
| R | python/address.py | 5 | movedIn | `self._postal_code = postal_code` |
| R | python/address.py | 7 | inserted | `def format(self):` |
| R | python/address.py | 8 | inserted | `return f"{self._street}\n{self._city} {self._postal_code}"` |
| R | python/address.py | 10 | inserted | `# testing python code 2 222 2. 2` |

## [19] Change Method Access Modifier

| side | file | line | category | code |
|---|---|---|---|---|
| L | python/order_processor.py | 24 | updated | `def _format_header(self, customer_name):` |
| R | python/receipt_formatter.py | 2 | updated | `def create_receipt_header(self, customer_name):` |

## [20] Move And Rename Method

| side | file | line | category | code |
|---|---|---|---|---|
| L | python/order_processor.py | 24 | updated | `def _format_header(self, customer_name):` |
| R | python/receipt_formatter.py | 2 | updated | `def create_receipt_header(self, customer_name):` |

## [21] Extract And Move Method

| side | file | line | category | code |
|---|---|---|---|---|
| L | python/admin_account.py | 3 | movedOut | `self._username = username` |
| R | python/account.py | 2 | inserted | `def __init__(self, username):` |
| R | python/account.py | 3 | movedIn | `self._username = username` |
| R | python/admin_account.py | 6 | inserted | `super().__init__(username)` |

## [22] Extract And Move Method

| side | file | line | category | code |
|---|---|---|---|---|
| L | python/guest_account.py | 3 | movedOut | `self._username = username` |
| R | python/account.py | 2 | inserted | `def __init__(self, username):` |
| R | python/account.py | 3 | movedIn | `self._username = username` |
| R | python/guest_account.py | 6 | inserted | `super().__init__(username)` |

## [23] Extract And Move Method

| side | file | line | category | code |
|---|---|---|---|---|
| L | python/customer_profile.py | 10 | updated | `return f"{self._full_name}\n{self._street}\n{self._city} {self._postal_code}"` |
| R | python/address.py | 7 | inserted | `def format(self):` |
| R | python/address.py | 8 | inserted | `return f"{self._street}\n{self._city} {self._postal_code}"` |
| R | python/address.py | 10 | inserted | `# testing python code 2 222 2. 2` |
| R | python/customer_profile.py | 11 | inserted | `return f"{self._display_name}\n{self._address.format()}"` |

## [24] Extract Superclass

| side | file | line | category | code |
|---|---|---|---|---|
| L | python/admin_account.py | 1 | updated | `class AdminAccount:` |
| R | python/account.py | 1 | inserted | `class Account:` |
| R | python/account.py | 2 | inserted | `def __init__(self, username):` |
| R | python/account.py | 3 | movedIn | `self._username = username` |
| R | python/account.py | 5 | movedIn | `def display_name(self):` |
| R | python/account.py | 6 | inserted | `return self._username.strip().upper()` |
| R | python/account.py | 7 | inserted | `#test commit 2 22 222` |
| R | python/admin_account.py | 4 | inserted | `class AdminAccount(Account):` |

## [25] Extract Superclass

| side | file | line | category | code |
|---|---|---|---|---|
| L | python/guest_account.py | 1 | updated | `class GuestAccount:` |
| R | python/account.py | 1 | inserted | `class Account:` |
| R | python/account.py | 2 | inserted | `def __init__(self, username):` |
| R | python/account.py | 3 | movedIn | `self._username = username` |
| R | python/account.py | 5 | movedIn | `def display_name(self):` |
| R | python/account.py | 6 | inserted | `return self._username.strip().upper()` |
| R | python/account.py | 7 | inserted | `#test commit 2 22 222` |
| R | python/guest_account.py | 4 | inserted | `class GuestAccount(Account):` |
