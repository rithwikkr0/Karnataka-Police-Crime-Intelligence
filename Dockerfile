FROM python:3.9-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
ENV PORT=9000
EXPOSE 9000
CMD ["python3", "server.py"]
