from flask import Flask, render_template, jsonify, request
from datetime import datetime, timedelta
import requests
import json
import os
import sqlite3
import threading
import time
import urllib.parse
from functools import wraps
from dotenv import load_dotenv

load_dotenv()

class Config:
    DATABASE_PATH = os.environ.get('DATABASE_PATH', 'auction.db')
    TELEGRAM_BOT_TOKEN = os.environ.get('TELEGRAM_BOT_TOKEN', '')
    ADMIN_CHAT_ID = int(os.environ.get('ADMIN_CHAT_ID', 0))
    SECRET_KEY = os.environ.get('SECRET_KEY', 'dev-secret-key-12345')
    AUCTION_EXTENSION_MINUTES = int(os.environ.get('AUCTION_EXTENSION_MINUTES', 5))

app = Flask(__name__)
app.config.from_object(Config)

@app.after_request
def add_no_cache_headers(response):
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    return response

def init_db():
    conn = sqlite3.connect(Config.DATABASE_PATH)
    cursor = conn.cursor()
    
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS lots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        image_url TEXT NOT NULL,
        auction_duration INTEGER NOT NULL,
        current_price INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_by INTEGER,
        deadline DATETIME,
        last_bidder_id INTEGER,
        last_bidder_username TEXT,
        last_bidder_first_name TEXT,
        winner_id INTEGER,
        winner_username TEXT,
        winner_first_name TEXT,
        sold_at DATETIME
    )
    ''')
    
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS bid_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lot_id INTEGER,
        user_id INTEGER,
        username TEXT,
        first_name TEXT,
        amount INTEGER,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (lot_id) REFERENCES lots (id)
    )
    ''')
    
    conn.commit()
    conn.close()
    print("✅ Database initialized successfully")

init_db()

def get_db_connection():
    conn = sqlite3.connect(Config.DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def send_telegram_message(chat_id, text, parse_mode=None):
    if not Config.TELEGRAM_BOT_TOKEN:
        print(f"📝 Message to {chat_id}: {text}")
        return True
        
    url = f"https://api.telegram.org/bot{Config.TELEGRAM_BOT_TOKEN}/sendMessage"
    payload = {
        'chat_id': chat_id,
        'text': text,
        'parse_mode': parse_mode
    }
    
    try:
        response = requests.post(url, json=payload, timeout=10)
        return response.status_code == 200
    except Exception as e:
        print(f"❌ Error sending message: {e}")
        return False

def notify_user(user_id, message):
    return send_telegram_message(user_id, message)

def notify_admin(message):
    if Config.ADMIN_CHAT_ID:
        return send_telegram_message(Config.ADMIN_CHAT_ID, message)
    print(f"📝 Admin notification: {message}")
    return True

def is_admin(user_id):
    return user_id == Config.ADMIN_CHAT_ID

def create_lot(name, image_url, auction_duration, created_by):
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute('''
    INSERT INTO lots (name, image_url, auction_duration, created_by)
    VALUES (?, ?, ?, ?)
    ''', (name, image_url, auction_duration, created_by))
    
    lot_id = cursor.lastrowid
    conn.commit()
    conn.close()
    
    return lot_id

def get_lot(lot_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute('SELECT * FROM lots WHERE id = ?', (lot_id,))
    lot = cursor.fetchone()
    
    if lot:
        cursor.execute('SELECT * FROM bid_history WHERE lot_id = ? ORDER BY timestamp DESC', (lot_id,))
        bid_history = cursor.fetchall()
        
        lot_dict = dict(lot)
        lot_dict['bid_history'] = [dict(bid) for bid in bid_history]
        
        conn.close()
        return lot_dict
    
    conn.close()
    return None

def get_active_lots():
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute('''
    SELECT * FROM lots 
    WHERE status = 'active' 
    AND (deadline IS NULL OR deadline > datetime('now'))
    ORDER BY created_at DESC
    ''')
    
    lots = cursor.fetchall()
    result = []
    
    for lot in lots:
        lot_dict = dict(lot)
        cursor.execute('SELECT * FROM bid_history WHERE lot_id = ? ORDER BY timestamp DESC', (lot_dict['id'],))
        bid_history = cursor.fetchall()
        lot_dict['bid_history'] = [dict(bid) for bid in bid_history]
        result.append(lot_dict)
    
    conn.close()
    return result

def get_sold_lots(limit=50):
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute('''
    SELECT * FROM lots 
    WHERE status = 'sold' 
    ORDER BY sold_at DESC 
    LIMIT ?
    ''', (limit,))
    
    lots = cursor.fetchall()
    result = []
    
    for lot in lots:
        lot_dict = dict(lot)
        cursor.execute('SELECT * FROM bid_history WHERE lot_id = ? ORDER BY timestamp DESC', (lot_dict['id'],))
        bid_history = cursor.fetchall()
        lot_dict['bid_history'] = [dict(bid) for bid in bid_history]
        result.append(lot_dict)
    
    conn.close()
    return result

def place_bid(lot_id, user_id, username, first_name, bid_amount):
    try:
        lot = get_lot(lot_id)
        if not lot:
            return False, 'Лот не найден', None
        
        if lot.get('deadline') and datetime.now() > datetime.fromisoformat(lot['deadline']):
            return False, 'Аукцион завершен', None
        
        if bid_amount != lot['current_price'] + 1:
            return False, 'Неверная сумма ставки', None
        
        previous_winner = None
        if lot.get('last_bidder_id'):
            previous_winner = {
                'user_id': lot['last_bidder_id'],
                'username': lot['last_bidder_username'],
                'first_name': lot['last_bidder_first_name']
            }
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        if lot.get('deadline'):
            new_deadline = (datetime.fromisoformat(lot['deadline']) + 
                           timedelta(minutes=Config.AUCTION_EXTENSION_MINUTES)).isoformat()
        else:
            new_deadline = (datetime.now() + 
                           timedelta(minutes=lot['auction_duration'])).isoformat()
        
        cursor.execute('''
        UPDATE lots 
        SET current_price = ?, last_bidder_id = ?, last_bidder_username = ?, 
            last_bidder_first_name = ?, deadline = ?
        WHERE id = ?
        ''', (bid_amount, user_id, username, first_name, new_deadline, lot_id))
        
        cursor.execute('''
        INSERT INTO bid_history (lot_id, user_id, username, first_name, amount)
        VALUES (?, ?, ?, ?, ?)
        ''', (lot_id, user_id, username, first_name, bid_amount))
        
        conn.commit()
        conn.close()
        
        updated_lot = get_lot(lot_id)
        return True, updated_lot, previous_winner
        
    except Exception as e:
        return False, f'Ошибка: {str(e)}', None

def complete_auction(lot_id):
    try:
        lot = get_lot(lot_id)
        if not lot:
            return False, 'Лот не найден'
        
        if lot.get('status') == 'sold':
            return False, 'Лот уже продан'
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('''
        UPDATE lots 
        SET status = 'sold', sold_at = datetime('now'),
            winner_id = ?, winner_username = ?, winner_first_name = ?
        WHERE id = ?
        ''', (lot.get('last_bidder_id'), 
              lot.get('last_bidder_username'), 
              lot.get('last_bidder_first_name'), 
              lot_id))
        
        conn.commit()
        conn.close()
        
        return True, lot
        
    except Exception as e:
        return False, f'Ошибка: {str(e)}'

def admin_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        try:
            init_data = request.headers.get('X-Telegram-Init-Data', '')
            if not init_data and 'tgWebAppData' in request.args:
                init_data = request.args['tgWebAppData']
            
            if not init_data:
                return jsonify({'success': False, 'error': 'Не авторизован'})
            
            user_id = None
            init_data_dict = {}
            
            try:
                decoded_data = urllib.parse.unquote(init_data)
                for part in decoded_data.split('&'):
                    if '=' in part:
                        key, value = part.split('=', 1)
                        init_data_dict[key] = value
                
                if 'user' in init_data_dict:
                    user_data = json.loads(init_data_dict['user'])
                    user_id = user_data.get('id')
            except Exception as e:
                print(f"Error parsing init data: {e}")
                return jsonify({'success': False, 'error': 'Ошибка авторизации'})
            
            if not user_id or not is_admin(user_id):
                return jsonify({'success': False, 'error': 'Доступ запрещен. Только для администраторов.'})
                
            return f(*args, **kwargs)
        except Exception as e:
            return jsonify({'success': False, 'error': f'Ошибка авторизации: {str(e)}'})
    return decorated_function

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/lots')
def get_lots():
    try:
        active_lots = get_active_lots()
        sold_lots = get_sold_lots()
        
        return jsonify({
            'success': True,
            'active_lots': active_lots,
            'sold_lots': sold_lots
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/lot/<int:lot_id>')
def get_lot_info(lot_id):
    try:
        lot = get_lot(lot_id)
        if not lot:
            return jsonify({'success': False, 'error': 'Лот не найден'})
        
        return jsonify({'success': True, 'lot': lot})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/place_bid', methods=['POST'])
def api_place_bid():
    try:
        data = request.json
        lot_id = data.get('lot_id')
        user_id = data.get('user_id')
        username = data.get('username')
        first_name = data.get('first_name')
        
        if not all([lot_id, user_id]):
            return jsonify({'success': False, 'error': 'Недостаточно данных'})
        
        lot = get_lot(lot_id)
        if not lot:
            return jsonify({'success': False, 'error': 'Лот не найден'})
        
        bid_amount = lot['current_price'] + 1
        
        success, result, previous_winner = place_bid(
            lot_id, user_id, username, first_name, bid_amount
        )
        
        if success:
            if (previous_winner and 
                previous_winner['user_id'] != user_id and 
                previous_winner['user_id'] is not None):
                
                notify_user(
                    previous_winner['user_id'],
                    f"⚠️ Вашу ставку на '{lot['name']}' перебили!\n\n"
                    f"Текущая цена: {bid_amount} ⭐\n"
                    f"Срочно перебейте ставку!"
                )
            
            return jsonify({'success': True, 'lot': result})
        else:
            return jsonify({'success': False, 'error': result})
            
    except Exception as e:
        return jsonify({'success': False, 'error': f'Внутренняя ошибка: {str(e)}'})

@app.route('/admin/create_lot', methods=['POST'])
@admin_required
def admin_create_lot():
    try:
        data = request.json
        name = data.get('name')
        image_url = data.get('image_url')
        auction_duration = data.get('auction_duration', 60)
        
        if not all([name, image_url]):
            return jsonify({'success': False, 'error': 'Недостаточно данных'})
        
        init_data = request.headers.get('X-Telegram-Init-Data', '')
        admin_id = None
        
        try:
            decoded_data = urllib.parse.unquote(init_data)
            for part in decoded_data.split('&'):
                if part.startswith('user='):
                    user_data = json.loads(part[5:])
                    admin_id = user_data.get('id')
                    break
        except:
            pass
        
        if not admin_id:
            admin_id = Config.ADMIN_CHAT_ID
        
        lot_id = create_lot(name, image_url, auction_duration, admin_id)
        return jsonify({'success': True, 'lot_id': lot_id})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/admin/list_lots', methods=['GET'])
@admin_required
def admin_list_lots():
    try:
        active_lots = get_active_lots()
        sold_lots = get_sold_lots(100)
        
        return jsonify({
            'success': True,
            'active_lots': active_lots,
            'sold_lots': sold_lots
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/health')
def health_check():
    return jsonify({
        'status': 'healthy',
        'timestamp': datetime.now().isoformat(),
        'database': 'connected'
    })

def check_expired_auctions():
    while True:
        try:
            conn = get_db_connection()
            cursor = conn.cursor()
            
            cursor.execute('''
            SELECT * FROM lots 
            WHERE status = 'active' 
            AND deadline IS NOT NULL 
            AND deadline < datetime('now')
            ''')
            
            expired_lots = cursor.fetchall()
            
            for lot_row in expired_lots:
                lot = dict(lot_row)
                success, result = complete_auction(lot['id'])
                if success:
                    print(f"✅ Auction completed: {lot['name']}")
                    
                    if result.get('last_bidder_id'):
                        winner_name = result.get('last_bidder_username') or result.get('last_bidder_first_name') or 'Пользователь'
                        notify_user(
                            result['last_bidder_id'],
                            f"🎉 Поздравляем! Вы победили в аукционе за '{result['name']}'\n\n"
                            f"Финальная цена: {result['current_price']} ⭐\n"
                            f"Напишите администратору для получения вашего подарка."
                        )
                    
                    winner_info = result.get('last_bidder_username') or result.get('last_bidder_first_name') or 'Неизвестный'
                    notify_admin(
                        f"🏆 Аукцион завершен: '{result['name']}'\n"
                        f"Победитель: {winner_info}\n"
                        f"Цена: {result['current_price']} ⭐\n"
                        f"Время: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"
                    )
                else:
                    print(f"❌ Failed to complete auction: {result}")
            
            conn.close()
                
        except Exception as e:
            print(f"❌ Error in auction checker: {e}")
        
        time.sleep(60)

checker_thread = threading.Thread(target=check_expired_auctions, daemon=True)
checker_thread.start()
print("✅ Auction checker thread started")

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=os.environ.get('DEBUG', 'False').lower() == 'true')


