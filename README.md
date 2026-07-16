ROS2 UI Stack Auto-Start Setup Guide
Overview
This setup automatically starts:
    • ROSBridge WebSocket Server (Port 9090)
    • Flask Backend Server (Port 5000)
    • Web Video Server (Optional)
    • ROS2 UI Backend Services
using a systemd service during system boot.

1. Verify User and ROS Domain
Check user information:
id svr
Example:
uid=1000(svr) gid=1000(svr)
Check ROS Domain ID:
echo $ROS_DOMAIN_ID
If no value is returned, use:
export ROS_DOMAIN_ID=0
Update the startup script if a different domain is required.

2. Build Workspace
Verify workspace is built:
cd ~/ui_ws

source /opt/ros/humble/setup.bash

colcon build
Verify installation:
ls ~/ui_ws/install/setup.bash
Expected:
/home/svr/ui_ws/install/setup.bash

3. Create Startup Script
Create file:
gedit /home/svr/start_ui_stack.sh
Paste:
#!/bin/bash

echo "========== UI STACK START =========="

# Environment
export HOME=/home/svr
export USER=svr
export ROS_DOMAIN_ID=42
export PYTHONUNBUFFERED=1
export PYTHONPATH=/home/svr/ui_ws/install/lib/python3.10/site-packages:$PYTHONPATH

source /opt/ros/humble/setup.bash
source /home/svr/ui_ws/install/setup.bash

LOG_DIR=/home/svr/logs
mkdir -p "$LOG_DIR"

cleanup() {
    echo "Stopping UI Stack..."
}
trap cleanup SIGTERM SIGINT

# Start rosbridge
echo "Starting rosbridge..."
ros2 launch rosbridge_server rosbridge_websocket_launch.xml \
>> "$LOG_DIR/rosbridge.log" 2>&1 &
ROSBRIDGE_PID=$!

# Wait for rosbridge
echo "Waiting for rosbridge..."
for i in $(seq 1 30); do
    if ss -tln | grep -q ':9090'; then
        echo "Rosbridge started successfully"
        break
    fi
    sleep 1
done

# Start web_video_server if installed
if ros2 pkg list | grep -q "^web_video_server$"; then
    echo "Starting web_video_server..."
    ros2 run web_video_server web_video_server \
    >> "$LOG_DIR/web_video.log" 2>&1 &
    WVS_PID=$!
else
    echo "web_video_server not installed, skipping..."
    WVS_PID="N/A"
fi

sleep 2

# Start Backend
echo "Starting backend..."
python3 /home/svr/ui_ws/src/delivery_ui/backend/server.py \
>> "$LOG_DIR/backend.log" 2>&1 &
BACKEND_PID=$!

echo "==================================="
echo "All services started"
echo "rosbridge PID : $ROSBRIDGE_PID"
echo "web_video PID : $WVS_PID"
echo "backend PID   : $BACKEND_PID"
echo "==================================="

while true; do
    sleep 60
done
Make executable:
chmod +x /home/svr/start_ui_stack.sh

4. Create Systemd Service
Create:
sudo gedit /etc/systemd/system/robot_ui_stack.service
Paste:
[Unit]
Description=ROS2 UI Stack
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=svr
Group=svr
WorkingDirectory=/home/svr/ui_ws

Environment="HOME=/home/svr"
Environment="ROS_DOMAIN_ID=42"
Environment="PYTHONUNBUFFERED=1"
Environment="XDG_RUNTIME_DIR=/run/user/1000"

ExecStart=/bin/bash /home/svr/start_ui_stack.sh

Restart=always
RestartSec=5

StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
Replace UID if different from 1000.

5. Enable Service
Reload:
sudo systemctl daemon-reload
Enable:
sudo systemctl enable robot_ui_stack.service
Start:
sudo systemctl start robot_ui_stack.service

6. Verify Service
Check:
systemctl status robot_ui_stack.service
Expected:
Active: active (running)

7. Verify Processes
Rosbridge:
ps -ef | grep rosbridge_websocket
Backend:
ps -ef | grep server.py

8. Verify Ports
Rosbridge:
ss -tlnp | grep 9090
Expected:
LISTEN ... :9090
Backend:
ss -tlnp | grep 5000
Expected:
LISTEN ... :5000

9. View Logs
Systemd:
journalctl -u robot_ui_stack.service -f
Rosbridge:
tail -f /home/svr/logs/rosbridge.log
Backend:
tail -f /home/svr/logs/backend.log
Web Video:
tail -f /home/svr/logs/web_video.log

10. Reboot Validation
sudo reboot
After reboot:
systemctl status robot_ui_stack.service
Expected:
Active: active (running)

Troubleshooting
Error: setup.bash not found
/home/svr/ui_ws/install/setup.bash: No such file or directory
Solution:
cd ~/ui_ws
source /opt/ros/humble/setup.bash
colcon build

Error: rosbridge_server package not found
Package 'rosbridge_server' not found
Install:
sudo apt install ros-humble-rosbridge-server
Verify:
ros2 pkg list | grep rosbridge

Error: web_video_server package not found
Package 'web_video_server' not found
Install:
sudo apt install ros-humble-web-video-server
If not required, the script automatically skips it.

Error: Flask not installed
ModuleNotFoundError: No module named 'flask'
Install:
sudo apt install python3-flask python3-flask-cors
or
pip3 install flask flask-cors
Verify:
python3 -c "from flask import Flask; print('Flask OK')"

Service Restart Loop
Symptoms:
Stopping all processes...
Stopping all processes...
Stopping all processes...
Cause:
trap cleanup SIGTERM SIGINT EXIT
kill -- -$$
Solution:
Remove:
trap cleanup SIGTERM SIGINT EXIT
Replace with:
trap cleanup SIGTERM SIGINT
and remove:
kill -- -$$

Backend Not Running
Check:
cat /home/svr/logs/backend.log
Run manually:
python3 /home/svr/ui_ws/src/delivery_ui/backend/server.py
Fix any missing Python dependencies reported.

ROS Domain Communication Issue
Check:
echo $ROS_DOMAIN_ID
Ensure the robot, backend and UI use the same Domain ID.
Example:
export ROS_DOMAIN_ID=42

Final Validation Checklist
✓ robot_ui_stack.service active
✓ rosbridge running
✓ Port 9090 open
✓ Backend running
✓ Port 5000 open
✓ Logs generated
✓ Service auto-starts after reboot
✓ ROS Domain ID correct
✓ UI accessible from browser
