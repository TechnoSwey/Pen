import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    DATABASE_PATH = os.environ.get('DATABASE_PATH', 'auction.db')
    TELEGRAM_BOT_TOKEN = os.environ.get('TELEGRAM_BOT_TOKEN', '')
    ADMIN_CHAT_ID = int(os.environ.get('ADMIN_CHAT_ID', 0))
    SECRET_KEY = os.environ.get('SECRET_KEY', 'dev-secret-key-12345')
    AUCTION_EXTENSION_MINUTES = int(os.environ.get('AUCTION_EXTENSION_MINUTES', 5))
