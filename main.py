from flask import Flask, render_template, send_from_directory

app = Flask(__name__)

@app.route('/')
def home():
    return render_template('index.html')

@app.route('/rmp/scripts/<path:filename>')
def rmp_files(filename):
    return send_from_directory('rmp/scripts', filename)

@app.route('/<path:path>')
def catch_all(path):
    # Redirect all other routes to the main page for single-page design
    return render_template('index.html')

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
