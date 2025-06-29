import os
from project import create_app

# The Flask application instance is created by calling create_app()
app = create_app()

# This is the entry point for running the application
if __name__ == '__main__':
    # Get port from environment variables or default to 5000
    port = int(os.environ.get("PORT", 5000))
    # Run the app. debug=True is good for development as it shows errors.
    # For production, you would typically use a Gunicorn server.
    app.run(host='0.0.0.0', port=port, debug=True)