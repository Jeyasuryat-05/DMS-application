#!/usr/bin/env python
import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.development')
django.setup()

from api.models import User
from api.authentication import hash_password

users = User.objects.all()
password = "Admin@1234"
hashed_password = hash_password(password)

print(f"Setting password for {users.count()} users...")
print("-" * 70)

for user in users:
    user.hashed_password = hashed_password
    user.save(update_fields=['hashed_password'])
    print(f"[OK] {user.employee_id:8} | {user.email:30} | {user.role}")

print("-" * 70)
print(f"[OK] Password set for all {users.count()} users!")
print(f"\nPassword for all users: Admin@1234")
