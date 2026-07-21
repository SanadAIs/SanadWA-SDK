<?php

return [
    'api_key' => env('SANAD_API_KEY'),
    'base_url' => env('SANAD_API_BASE_URL', 'https://api.sanadwa.com/api/public/v1'),
    'retries' => (int) env('SANAD_API_RETRIES', 5),
    'timeout' => (float) env('SANAD_TIMEOUT', 30.0),
    'connect_timeout' => (float) env('SANAD_CONNECT_TIMEOUT', 10.0),
    'webhook_secret' => env('SANAD_WEBHOOK_SECRET'),
];
