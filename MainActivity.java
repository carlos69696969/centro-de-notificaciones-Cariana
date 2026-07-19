// Copyright 2026 (c) WebIntoApp.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy of
// this software and associated documentation files (the "Software"), to deal in the
// Software without restriction, including without limitation the rights to use,
// copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the
// Software, and to permit persons to whom the Software is furnished to do so,
// subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
//  CARIANA
//
//  Created by CarlosJuarez on 19/02/2026.
//
package com.carlosjuarez.cariana;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.annotation.SuppressLint;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.Point;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.content.Context;
import androidx.annotation.RequiresApi;
import androidx.annotation.NonNull;
import androidx.core.app.ActivityCompat;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.DownloadListener;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.RenderProcessGoneDetail;
import android.text.TextUtils;
import android.text.InputType;
import android.widget.EditText;
import android.webkit.ValueCallback;
import android.provider.MediaStore;
import java.io.IOException;
import java.net.URISyntaxException;
import android.app.Activity;
import android.Manifest;
import android.webkit.URLUtil;
import android.app.AlertDialog;
import android.content.DialogInterface;
import android.webkit.CookieManager;
import android.content.SharedPreferences;
import android.widget.FrameLayout;
import android.widget.Toast;
import java.io.DataOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.text.DateFormat;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashMap;
import java.util.Map;
import android.view.KeyEvent;
import org.jetbrains.annotations.NotNull;
import android.widget.FrameLayout;
import android.graphics.BitmapFactory;
import android.os.AsyncTask;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.io.BufferedWriter;
import java.io.OutputStreamWriter;
import java.io.InputStreamReader;
import java.io.BufferedReader;
import android.graphics.Color;
import android.graphics.Insets;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;
import android.util.Log;
import android.widget.FrameLayout;
import android.graphics.BitmapFactory;
import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;
public class MainActivity extends AppCompatActivity {
    private WebView mWebView;
    private WebView splash_mWebView;
    private ValueCallback<Uri[]> mFilePathCallback;
    private String mCameraPhotoPath;
    private static final String TAG = "MainActivity";
    private static final String DEFAULT_HOME_URL = "https://cariana.mx/";
    private static final String BACKUP_HOME_URL = "https://cariana-3.myshopify.com/";
    public static final String EXTRA_TARGET_URL = "extra_target_url";
    SharedPreferences prefs = null;
    int width = 0, height = 0;
    boolean display_error = false;
    boolean no_internet = false;
    SwipeRefreshLayout swipeRefreshLayout;
    SwipeRefreshLayout NavigateProgressBar;
    GeolocationPermissions.Callback mGeoLocationCallback = null;
    String mGeoLocationRequestOrigin = null;
    static final int INPUT_FILE_REQUEST_CODE = 1;
    static final int PERMISSION_LOC = 100;
    static final int PERMISSION_VIDEO_CAPTURE1 = 1001;
    static final int PERMISSION_VIDEO_CAPTURE2 = 1002;
    static final int PERMISSION_POST_NOTIFICATIONS = 1003;
    static final int PERMISSION_AUDIO = 106;
    PermissionRequest permissionRequest;
    static boolean homeLoaded = false;
    static String currentUrl = "";
    private boolean renderRecoveryScheduled = false;
    private String pendingNavigationUrl = "";
    private long pendingNavigationStartedAt = 0L;
    private int pendingNavigationRecoveries = 0;
    private boolean cleanNavigationInProgress = false;
    private boolean whiteScreenRecoveryScheduled = false;
    @RequiresApi(api = Build.VERSION_CODES.M)
    @SuppressLint({"SetJavaScriptEnabled", "CutPasteId"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
        WebView splash_mWebView = (WebView) findViewById(R.id.activity_splash_webview);
        splash_mWebView.setWebChromeClient(new WebChromeClient());
        splash_mWebView.setWebViewClient(new WebViewClient());
        WebSettings webSettings_splash = splash_mWebView.getSettings();
        webSettings_splash.setJavaScriptEnabled(true);
        splash_mWebView.loadUrl("file:///android_asset/htmlapp/helpers/loading.html");
        if (Build.VERSION.SDK_INT >= 35) { // VANILLA_ICE_CREAM / Android 15
            View decorView = getWindow().getDecorView();
            decorView.setOnApplyWindowInsetsListener((v, insets) -> {
                v.setBackgroundColor(Color.parseColor("#1a1a1a"));
                Insets statusBarInsets = insets.getInsets(WindowInsets.Type.statusBars());
                v.setPadding(0, statusBarInsets.top, 0, 0);
                return insets;
            });
            getWindow().setDecorFitsSystemWindows(false);
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) {
                controller.setSystemBarsAppearance(0, WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS);
            }
        }
        prefs = getSharedPreferences("com.carlosjuarez.cariana", MODE_PRIVATE);
        mWebView = (WebView) findViewById(R.id.activity_main_webview);
        View container = findViewById(R.id.container);
        ViewCompat.setOnApplyWindowInsetsListener(container, (v, insets) -> {
            Insets ime = null;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ime = insets.getInsets(WindowInsetsCompat.Type.ime()).toPlatformInsets();
            }
            Insets systemBars = null;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars()).toPlatformInsets();
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                v.setPadding(0, 0, 0, ime.bottom);
            }
            return insets;
        });
        mWebView.setWebChromeClient(new WebChromeClient() {
            private View mCustomView;
            private WebChromeClient.CustomViewCallback mCustomViewCallback;
            protected FrameLayout mFullscreenContainer;
            private int mOriginalOrientation;
            private int mOriginalSystemUiVisibility;
            public void MyWebClient() {}
            public Bitmap getDefaultVideoPoster()
            {
                if (MainActivity.this == null) {
                    return null;
                }
                return BitmapFactory.decodeResource(MainActivity.this.getApplicationContext().getResources(), 2130837573);
            }
            @Override
            public void onHideCustomView()
            {
                ((FrameLayout)MainActivity.this.getWindow().getDecorView()).removeView(this.mCustomView);
                this.mCustomView = null;
                MainActivity.this.getWindow().getDecorView().setSystemUiVisibility(this.mOriginalSystemUiVisibility);
                MainActivity.this.setRequestedOrientation(this.mOriginalOrientation);
                this.mCustomViewCallback.onCustomViewHidden();
                this.mCustomViewCallback = null;
            }
            @Override
            public void onShowCustomView(View paramView, WebChromeClient.CustomViewCallback paramCustomViewCallback)
            {
                if (this.mCustomView != null)
                {
                    onHideCustomView();
                    return;
                }
                this.mCustomView = paramView;
                this.mOriginalSystemUiVisibility = MainActivity.this.getWindow().getDecorView().getSystemUiVisibility();
                this.mOriginalOrientation = MainActivity.this.getRequestedOrientation();
                this.mCustomViewCallback = paramCustomViewCallback;
                ((FrameLayout)MainActivity.this.getWindow().getDecorView()).addView(this.mCustomView, new FrameLayout.LayoutParams(-1, -1));
                MainActivity.this.getWindow().getDecorView().setSystemUiVisibility(3846);
            }
            @Override
            public void onCloseWindow(WebView window) {
            }
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                if (ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                    ActivityCompat.requestPermissions(MainActivity.this, new String[]{Manifest.permission.ACCESS_FINE_LOCATION}, PERMISSION_LOC);
                    mGeoLocationRequestOrigin = origin;
                    mGeoLocationCallback = callback;
                }
                else{
                    callback.invoke(origin, true, true);
                }
            }
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                permissionRequest = request;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    for(String permission: request.getResources()){
                        if(permission.equals(PermissionRequest.RESOURCE_VIDEO_CAPTURE)){
                            if (ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                                ActivityCompat.requestPermissions(MainActivity.this, new String[]{Manifest.permission.RECORD_AUDIO}, PERMISSION_VIDEO_CAPTURE2);
                                return;
                            }
                            else{
                                getVideoCapturePermission();
                            }
                        }
                    }
                }
            }
            @Override
            public boolean onShowFileChooser(
                WebView webView, ValueCallback<Uri[]> filePathCallback,
                WebChromeClient.FileChooserParams fileChooserParams) {
                if(mFilePathCallback != null) {
                    mFilePathCallback.onReceiveValue(null);
                }
                mFilePathCallback = filePathCallback;
                Intent takePictureIntent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                if (takePictureIntent.resolveActivity(MainActivity.this.getPackageManager()) != null) {
                    File photoFile = null;
                    try {
                        photoFile = createImageFile();
                        takePictureIntent.putExtra("PhotoPath", mCameraPhotoPath);
                    } catch (IOException ex) {
                        Log.e(TAG, "Unable to create Image File", ex);
                    }
                    if (photoFile != null) {
                        mCameraPhotoPath = "file:" + photoFile.getAbsolutePath();
                        takePictureIntent.putExtra(MediaStore.EXTRA_OUTPUT,
                            Uri.fromFile(photoFile));
                    } else {
                        takePictureIntent = null;
                    }
                }
                Intent contentSelectionIntent = new Intent(Intent.ACTION_GET_CONTENT);
                contentSelectionIntent.addCategory(Intent.CATEGORY_OPENABLE);
                contentSelectionIntent.setType("*/*");
                Intent[] intentArray;
                if(takePictureIntent != null) {
                    intentArray = new Intent[]{takePictureIntent};
                } else {
                    intentArray = new Intent[0];
                }
                Intent chooserIntent = new Intent(Intent.ACTION_CHOOSER);
                chooserIntent.putExtra(Intent.EXTRA_INTENT, contentSelectionIntent);
                chooserIntent.putExtra(Intent.EXTRA_TITLE, "Files Chooser");
                chooserIntent.putExtra(Intent.EXTRA_INITIAL_INTENTS, intentArray);
                startActivityForResult(chooserIntent, INPUT_FILE_REQUEST_CODE);
                return true;
            }
            @Override
            public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, android.os.Message resultMsg)
            {
                return true;
            }
        });
        swipeRefreshLayout = findViewById(R.id.swipeRefreshLayout);
        NavigateProgressBar = findViewById(R.id.swipeRefreshLayout);
        WebSettings settings = mWebView.getSettings();
        settings.setDomStorageEnabled(true);
        mWebView.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(final String url, final String userAgent, String contentDisposition, String mimetype, long contentLength) {
                    Log.v(TAG, "Permission is granted");
                    downloadDialog(url, userAgent, contentDisposition, mimetype);
            }
        });
        mWebView.setWebViewClient(new WebViewClient() {
            void IntentFallvack(WebView webView, Intent intent)
            {
                String fallbackUrl = intent.getStringExtra("browser_fallback_url");
                if (fallbackUrl != null) {
                    webView.loadUrl(fallbackUrl);
                }
            }
            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                currentUrl = url;
                pendingNavigationUrl = url;
                pendingNavigationStartedAt = System.currentTimeMillis();
                pendingNavigationRecoveries = 0;
                scheduleNavigationRecovery(view, url);
                if(homeLoaded) {
                    showProgress();
                }
                if (!checkInternetConnection(MainActivity.this)) {
                    hideProgress();
                }
                else {
                }
            }
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleWebViewUrlLoading(view, url);
            }
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri requestUri = request != null ? request.getUrl() : null;
                String requestUrl = requestUri != null ? requestUri.toString() : "";
                return handleWebViewUrlLoading(view, requestUrl);
            }
            private boolean handleWebViewUrlLoading(WebView view, String url) {
                if (TextUtils.isEmpty(url)) {
                    return false;
                }
                if (url.startsWith("native-share://")) {
                    handleNativeShareUrl(url);
                    return true;
                }
                if (url.startsWith("https") || url.startsWith("http")) {
                    if (cleanNavigationInProgress && url.equals(currentUrl)) {
                        cleanNavigationInProgress = false;
                        return false;
                    }
                    if (shouldUseCleanWebViewNavigation(url)) {
                        loadUrlCleanly(view, url);
                        return true;
                    }
                    return false;//open web links as usual
                }
                if (url.startsWith("mailto:")) {
                    Intent intent = new Intent(Intent.ACTION_SENDTO, Uri.parse(url));
                    try {
                        startActivity(intent);
                    } catch (ActivityNotFoundException e) {
                        Toast.makeText(MainActivity.this, "No email app found", Toast.LENGTH_SHORT).show();
                    }
                    return true;
                }
                else if (url.startsWith("tel:")) {
                    Intent intent = new Intent(Intent.ACTION_DIAL, Uri.parse(url));
                    try {
                        startActivity(intent);
                    } catch (ActivityNotFoundException e) {
                        Toast.makeText(MainActivity.this, "No phone app found", Toast.LENGTH_SHORT).show();
                    }
                    return true;
                }
                else if (url.startsWith("sms:") || url.startsWith("smsto:"))
                {
                    Intent intent = new Intent(Intent.ACTION_SENDTO);
                    intent.setData(Uri.parse(url));
                    try {
                        startActivity(intent);
                    } catch (ActivityNotFoundException e) {
                        Toast.makeText(MainActivity.this, "No SMS app found", Toast.LENGTH_SHORT).show();
                    }
                    return true;
                }
                else if (url.startsWith("geo:") || url.startsWith("maps:")) {
                    Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                    try {
                        startActivity(intent);
                    } catch (ActivityNotFoundException e) {
                        Toast.makeText(MainActivity.this, "No Maps app found", Toast.LENGTH_SHORT).show();
                    }
                    return true;
                }
                else if (url.startsWith("market:")) {
                    Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                    try {
                        startActivity(intent);
                    } catch (ActivityNotFoundException e) {
                        Toast.makeText(MainActivity.this, "No Play Store app found", Toast.LENGTH_SHORT).show();
                    }
                    return true;
                }
                else if (url.startsWith("whatsapp:") ||
                        url.startsWith("tg:") ||
                        url.startsWith("fb:") ||
                        url.startsWith("twitter:") ||
                        url.startsWith("skype:") ||
                        url.startsWith("zoomus:")) {
                    Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                    try {
                        startActivity(intent);
                    } catch (ActivityNotFoundException e) {
                        Toast.makeText(MainActivity.this, "App not installed", Toast.LENGTH_SHORT).show();
                    }
                    return true;
                }
                else if(url.startsWith("intent:")) {
                    Uri parsedUri = Uri.parse(url);
                    PackageManager packageManager = MainActivity.this.getPackageManager();
                    Intent browseIntent = new Intent(Intent.ACTION_VIEW).setData(parsedUri);
                    if (browseIntent.resolveActivity(packageManager) != null) {
                        MainActivity.this.startActivity(browseIntent);
                        return true;
                    }
                    try {
                        Intent intent = Intent.parseUri(url, Intent.URI_INTENT_SCHEME);
                        if (intent.resolveActivity(MainActivity.this.getPackageManager()) != null) {
                            MainActivity.this.startActivity(intent);
                            return true;
                        }
                        Intent marketIntent = new Intent(Intent.ACTION_VIEW).setData(
                            Uri.parse("market://details?id=" + intent.getPackage()));
                        if (marketIntent.resolveActivity(packageManager) != null) {
                            MainActivity.this.startActivity(marketIntent);
                            return true;
                        }
                        else
                            IntentFallvack(view, intent);
                    } catch (URISyntaxException e) {
                    }
                }
                return true;
            }
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(mWebView, url);
                hideProgress();
                swipeRefreshLayout.setRefreshing(false);
                findViewById(R.id.activity_splash_webview).setVisibility(View.GONE);
                findViewById(R.id.activity_main_webview).setVisibility(View.VISIBLE);
                display_error = true;
                enableNativeShareBridge(view);
                enablePushIdentityBridge(view);
                scheduleRenderRecovery(view);
                scheduleWhiteScreenRecovery(view);
                pendingNavigationUrl = "";
                pendingNavigationRecoveries = 0;
                if(!homeLoaded){
                    homeLoaded = true;
                }
            }
            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                Log.w(TAG, "WebView renderer process gone. Recovering.");
                if (view != null) {
                    view.destroy();
                }
                if (!isFinishing()) {
                    recreate();
                }
                return true;
            }
            @Override
            public void onReceivedError(@NonNull WebView view, @NonNull WebResourceRequest request, @NonNull WebResourceError error) {
                if (!display_error) {
                    mWebView.loadUrl("file:///android_asset/htmlapp/helpers/error.html");
                    display_error = true;
                }
                int errorCode = error.getErrorCode();
                switch (errorCode) {
                    case ERROR_CONNECT:
                        view.loadUrl("https://www.webintoapp.com/landing/ERROR_CONNECT");
                        break;
                    case ERROR_HOST_LOOKUP:
                        view.loadUrl("https://www.webintoapp.com/landing/ERROR_HOST_LOOKUP");
                        break;
                    case ERROR_TIMEOUT:
                        view.loadUrl("https://www.webintoapp.com/landing/ERROR_TIMEOUT");
                        break;
                }
            }
            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {
                super.onReceivedHttpError(view, request, errorResponse);
                if (request == null || errorResponse == null || !request.isForMainFrame()) {
                    return;
                }
                int statusCode = errorResponse.getStatusCode();
                if (statusCode >= 500 && statusCode <= 599) {
                    Uri failingUri = request.getUrl();
                    String failingUrl = failingUri != null ? failingUri.toString() : "";
                    if (!failingUrl.startsWith(BACKUP_HOME_URL)) {
                        Log.w(TAG, "Servidor principal con error " + statusCode + ". Cargando respaldo.");
                        view.loadUrl(BACKUP_HOME_URL);
                    }
                }
            }
            @Override
            public void onLoadResource(WebView  view, String  url){
                if (!checkInternetConnection(MainActivity.this)) {
                    if(!no_internet) {
                    }
                    no_internet = true;
                }
            }            
        });
        SetWebView(mWebView);
        if (!checkInternetConnection(MainActivity.this)) {
            mWebView.loadUrl("file:///android_asset/htmlapp/helpers/error.html");
            no_internet = true;
            return;
        }
        requestNotificationPermissionIfNeeded();
        initializeFirebaseMessaging();
        loadInitialUrl(getIntent());
        swipeRefreshLayout.setOnRefreshListener(new SwipeRefreshLayout.OnRefreshListener() {
            @Override
            public void onRefresh() {
                mWebView.reload();
            }
        });
    }
    private void requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(
                this,
                new String[]{Manifest.permission.POST_NOTIFICATIONS},
                PERMISSION_POST_NOTIFICATIONS
            );
        }
    }
    private void initializeFirebaseMessaging() {
        try {
            FirebaseApp firebaseApp = FirebaseApp.initializeApp(this);
            if (firebaseApp == null) {
                Log.w(TAG, "Firebase no configurado: falta google-services.json. Se omite FCM.");
                return;
            }
            FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
                if (!task.isSuccessful()) {
                    Log.w(TAG, "No se pudo obtener el token FCM", task.getException());
                    return;
                }
                String token = task.getResult();
                Log.d(TAG, "FCM token: " + token);
                PushSyncManager.syncToken(MainActivity.this, token);
            });
        } catch (Exception e) {
            Log.w(TAG, "Firebase no disponible en este build, se continua sin FCM.", e);
        }
    }
    private void loadInitialUrl(Intent intent) {
        String targetUrl = null;
        if (intent != null) {
            targetUrl = resolveIntentDeepLink(intent);
            if (TextUtils.isEmpty(targetUrl)) {
                String action = intent.getAction();
                if ("OPEN_ORDER_STATUS".equals(action)) {
                    targetUrl = "https://cariana.mx/account/orders";
                }
            }
        }
        if (TextUtils.isEmpty(targetUrl)) {
            targetUrl = DEFAULT_HOME_URL;
        }
        mWebView.loadUrl(targetUrl);
    }

    private String resolveIntentDeepLink(Intent intent) {
        if (intent == null) {
            return null;
        }

        String[] candidateKeys = new String[] {
            EXTRA_TARGET_URL,
            "deepLink",
            "deeplink",
            "url",
            "link",
            "targetUrl"
        };

        for (String key : candidateKeys) {
            String value = intent.getStringExtra(key);
            if (isTrustedDeepLink(value)) {
                return value;
            }
        }

        Uri data = intent.getData();
        if (data != null && isTrustedDeepLink(data.toString())) {
            return data.toString();
        }

        return null;
    }
    private boolean isTrustedDeepLink(String url) {
        if (TextUtils.isEmpty(url)) {
            return false;
        }

        Uri parsed = Uri.parse(url);
        String scheme = parsed.getScheme();
        String host = parsed.getHost();
        if (scheme == null || host == null) {
            return false;
        }

        if (!"https".equalsIgnoreCase(scheme)) {
            return false;
        }

        String normalizedHost = host.toLowerCase();
        return "cariana.mx".equals(normalizedHost)
            || "www.cariana.mx".equals(normalizedHost)
            || normalizedHost.endsWith(".myshopify.com")
            || "gestion-devoluciones-pro.onrender.com".equals(normalizedHost)
            || "centro-de-notificaciones-cariana.onrender.com".equals(normalizedHost);
    }
    private void handleNativeShareUrl(String url) {
        Uri parsed = Uri.parse(url);
        String text = parsed.getQueryParameter("text");
        String link = parsed.getQueryParameter("url");
        StringBuilder payload = new StringBuilder();
        if (!TextUtils.isEmpty(text)) {
            payload.append(text.trim());
        }
        if (!TextUtils.isEmpty(link)) {
            if (payload.length() > 0) {
                payload.append("\n");
            }
            payload.append(link.trim());
        }
        if (payload.length() == 0) {
            payload.append(currentUrl);
        }
        Intent shareIntent = new Intent(Intent.ACTION_SEND);
        shareIntent.setType("text/plain");
        shareIntent.putExtra(Intent.EXTRA_TEXT, payload.toString());
        startActivity(Intent.createChooser(shareIntent, "Compartir con"));
    }
    private void enableNativeShareBridge(WebView webView) {
        if (webView == null) {
            return;
        }
        String shareHookScript =
            "(function(){"
                + "if(window.__carianaShareHooked){return;}window.__carianaShareHooked=true;"
                + "var nativeShare=function(txt,url){"
                + "try{"
                + "if(window.Android&&Android.shareUrl){Android.shareUrl(url||window.location.href,txt||document.title);return true;}"
                + "}catch(e){}"
                + "return false;"
                + "};"
                + "if(navigator&&typeof navigator.share==='function'){"
                + "var originalShare=navigator.share.bind(navigator);"
                + "navigator.share=function(data){"
                + "var t=(data&&data.text)||document.title;"
                + "var u=(data&&data.url)||window.location.href;"
                + "if(nativeShare(t,u)){return Promise.resolve();}"
                + "return originalShare(data);"
                + "};"
                + "}"
                + "document.addEventListener('click',function(ev){"
                + "var el=ev.target&&ev.target.closest?ev.target.closest('button,a,[role=\"button\"]'):null;"
                + "if(!el){return;}"
                + "var text=((el.innerText||el.textContent||'')+' '+(el.getAttribute('aria-label')||'')+' '+(el.getAttribute('title')||'')).toLowerCase();"
                + "if(text.indexOf('compartir')===-1&&text.indexOf('share')===-1){return;}"
                + "ev.preventDefault();ev.stopPropagation();"
                + "nativeShare(document.title,window.location.href);"
                + "},true);"
            + "})();";
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            webView.evaluateJavascript(shareHookScript, null);
        } else {
            webView.loadUrl("javascript:" + shareHookScript);
        }
    }
    private void enablePushIdentityBridge(WebView webView) {
        if (webView == null) {
            return;
        }
        String pushIdentityScript =
            "(function(){"
                + "if(window.__carianaPushIdentityHooked){return;}window.__carianaPushIdentityHooked=true;"
                + "var syncIdentity=function(){"
                + "try{"
                + "if(!window.Android){return;}"
                + "var shop='';"
                + "if(window.Shopify&&Shopify.shop){shop=String(Shopify.shop);}"
                + "var customerId='';"
                + "var email='';"
                + "if(window.ShopifyAnalytics&&ShopifyAnalytics.meta){"
                + "var meta=ShopifyAnalytics.meta;"
                + "if(meta.page&&meta.page.customerId){customerId=String(meta.page.customerId);}"
                + "if(meta.page&&meta.page.customerEmail){email=String(meta.page.customerEmail);}"
                + "}"
                + "if(!customerId&&window.__st&&__st.cid){customerId=String(__st.cid);}"
                + "if(!email){"
                + "var emailInput=document.querySelector('input[name=\\\"customer[email]\\\"][value], input[type=\\\"email\\\"][value]');"
                + "if(emailInput&&emailInput.value){email=String(emailInput.value);}"
                + "}"
                + "if(shop&&Android.setPushShopDomain){Android.setPushShopDomain(shop);}"
                + "if((customerId||email)&&Android.setPushUserWithShop){Android.setPushUserWithShop(customerId,email,shop);}"
                + "else if((customerId||email)&&Android.setPushUser){Android.setPushUser(customerId,email);}"
                + "}catch(e){}"
                + "};"
                + "setTimeout(syncIdentity, 300);"
                + "setTimeout(syncIdentity, 1200);"
                + "setTimeout(syncIdentity, 3000);"
                + "window.addEventListener('focus', syncIdentity);"
                + "document.addEventListener('visibilitychange', function(){if(!document.hidden){syncIdentity();}});"
            + "})();";

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            webView.evaluateJavascript(pushIdentityScript, null);
        } else {
            webView.loadUrl("javascript:" + pushIdentityScript);
        }
    }
    private void scheduleRenderRecovery(WebView webView) {
        if (webView == null || renderRecoveryScheduled) {
            return;
        }
        renderRecoveryScheduled = true;
        webView.postDelayed(new Runnable() {
            @Override
            public void run() {
                renderRecoveryScheduled = false;
                if (mWebView == null) {
                    return;
                }
                mWebView.invalidate();
                mWebView.requestLayout();
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
                    mWebView.evaluateJavascript(
                        "(function(){try{document.body&&document.body.offsetHeight;window.dispatchEvent(new Event('resize'));}catch(e){}})();",
                        null
                    );
                }
            }
        }, 700);
    }
    private void scheduleWhiteScreenRecovery(WebView webView) {
        if (webView == null || whiteScreenRecoveryScheduled) {
            return;
        }
        whiteScreenRecoveryScheduled = true;
        webView.postDelayed(new Runnable() {
            @Override
            public void run() {
                whiteScreenRecoveryScheduled = false;
                if (mWebView == null) {
                    return;
                }
                try {
                    mWebView.onPause();
                    mWebView.pauseTimers();
                    mWebView.onResume();
                    mWebView.resumeTimers();
                } catch (Exception ignored) {
                }
                mWebView.setAlpha(0.99f);
                mWebView.invalidate();
                mWebView.requestLayout();
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
                    mWebView.evaluateJavascript(
                        "(function(){try{document.documentElement.style.webkitTransform='translateZ(0)';document.body.style.webkitTransform='translateZ(0)';window.dispatchEvent(new Event('resize'));setTimeout(function(){document.documentElement.style.webkitTransform='';document.body.style.webkitTransform='';},80);}catch(e){}})();",
                        null
                    );
                }
                mWebView.postDelayed(new Runnable() {
                    @Override
                    public void run() {
                        if (mWebView == null) {
                            return;
                        }
                        mWebView.setAlpha(1f);
                        mWebView.invalidate();
                    }
                }, 120);
            }
        }, 250);
    }
    private void scheduleNavigationRecovery(WebView webView, String navigationUrl) {
        if (webView == null || TextUtils.isEmpty(navigationUrl)) {
            return;
        }
        webView.postDelayed(new Runnable() {
            @Override
            public void run() {
                if (mWebView == null || TextUtils.isEmpty(pendingNavigationUrl)) {
                    return;
                }
                if (!navigationUrl.equals(pendingNavigationUrl)) {
                    return;
                }
                int progress = mWebView.getProgress();
                long elapsedMs = System.currentTimeMillis() - pendingNavigationStartedAt;
                if (progress >= 100 || elapsedMs < 1200) {
                    return;
                }
                mWebView.invalidate();
                mWebView.requestLayout();
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
                    mWebView.evaluateJavascript(
                        "(function(){try{document.body&&document.body.offsetHeight;window.dispatchEvent(new Event('resize'));}catch(e){}})();",
                        null
                    );
                }
                if (pendingNavigationRecoveries < 1 && elapsedMs >= 3500) {
                    pendingNavigationRecoveries += 1;
                    Log.w(TAG, "WebView navigation stalled. Reloading current page cleanly.");
                    mWebView.stopLoading();
                    loadUrlCleanly(mWebView, navigationUrl);
                    return;
                }
                scheduleNavigationRecovery(mWebView, navigationUrl);
            }
        }, 1400);
    }
    private boolean shouldUseCleanWebViewNavigation(String url) {
        if (TextUtils.isEmpty(url)) {
            return false;
        }
        Uri parsedUri = Uri.parse(url);
        String host = parsedUri.getHost();
        String path = parsedUri.getPath();
        if (TextUtils.isEmpty(host) || TextUtils.isEmpty(path)) {
            return false;
        }
        boolean trustedStore = host.equals("cariana.mx") || host.endsWith(".myshopify.com");
        return trustedStore && path.contains("/products/");
    }
    private void loadUrlCleanly(WebView webView, String url) {
        if (webView == null || TextUtils.isEmpty(url)) {
            return;
        }
        if (cleanNavigationInProgress && url.equals(currentUrl)) {
            return;
        }
        cleanNavigationInProgress = true;
        currentUrl = url;
        pendingNavigationUrl = url;
        pendingNavigationStartedAt = System.currentTimeMillis();
        pendingNavigationRecoveries = 0;
        webView.stopLoading();
        webView.clearCache(false);
        webView.clearHistory();
        webView.post(new Runnable() {
            @Override
            public void run() {
                webView.loadUrl(url);
                scheduleNavigationRecovery(webView, url);
            }
        });
    }
    private void getVideoCapturePermission() {
        permissionRequest.grant(permissionRequest.getResources());
    }
    public static boolean checkAudioPermission(Activity activity){
        return ContextCompat.checkSelfPermission(activity, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
    }
    public static void getAudioPermission(Activity activity) {
        ActivityCompat.requestPermissions(activity, new String[]{Manifest.permission.RECORD_AUDIO}, MainActivity.PERMISSION_AUDIO);
    }
    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == PERMISSION_POST_NOTIFICATIONS) {
            return;
        }
        if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            if (requestCode == PERMISSION_LOC) {
                if (mGeoLocationCallback != null)
                    mGeoLocationCallback.invoke(mGeoLocationRequestOrigin, true, true);
            }
            else if(requestCode == PERMISSION_VIDEO_CAPTURE1){
                if(!checkAudioPermission(MainActivity.this)){
                    getAudioPermission(MainActivity.this);
                }
                else{
                    getVideoCapturePermission();
                }
            }
            else if(requestCode == PERMISSION_VIDEO_CAPTURE2){
                getVideoCapturePermission();
            }
            mWebView.reload();
        }
    }
    public void downloadDialog(final String url, final String userAgent, final String contentDisposition, final String mimetype) {
        if(url.startsWith("blob")) {
            mWebView.loadUrl(JavaScriptInterface.getBase64StringFromBlobUrl(url, mimetype));
        }
        else {
            final String filename = URLUtil.guessFileName(url, contentDisposition, mimetype);
            AlertDialog.Builder builder = new AlertDialog.Builder(this);
            builder.setTitle("Download");
            builder.setMessage("Download File" + ' ' + filename);
            builder.setPositiveButton("Yes", new DialogInterface.OnClickListener() {
                @Override
                public void onClick(DialogInterface dialog, int which) {
                        DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                        String cookie = CookieManager.getInstance().getCookie(url);
                        request.addRequestHeader("Cookie", cookie);
                        request.addRequestHeader("User-Agent", userAgent);
                        request.allowScanningByMediaScanner();
                        request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                        DownloadManager downloadManager = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
                        request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, filename);
                        downloadManager.enqueue(request);
                }
            });
            builder.setNegativeButton("No", new DialogInterface.OnClickListener() {
                @Override
                public void onClick(DialogInterface dialog, int which) {
                    dialog.cancel();
                }
            });
            builder.show();
        }
    }
    public void showProgress(){
            NavigateProgressBar.setRefreshing(true);
    }
    public void hideProgress(){
        NavigateProgressBar.setRefreshing(false);
    }
    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private void SetWebView(WebView wv) {
        WebSettings webSettings = wv.getSettings();
        webSettings.setJavaScriptEnabled(true);
        webSettings.setDomStorageEnabled(true);
        webSettings.setCacheMode(WebSettings.LOAD_DEFAULT);
        webSettings.setSupportMultipleWindows(false);
        webSettings.setJavaScriptCanOpenWindowsAutomatically(true);
        webSettings.setAllowFileAccess(true);
        webSettings.setBuiltInZoomControls(false);
        webSettings.setDisplayZoomControls(false);
        webSettings.setLoadWithOverviewMode(true);
        webSettings.setUseWideViewPort(true);
        webSettings.setAllowFileAccessFromFileURLs(true);
        webSettings.setAllowUniversalAccessFromFileURLs(true);
        webSettings.setSupportZoom(true);
        webSettings.setDatabaseEnabled(true);
        webSettings.setLoadsImagesAutomatically(true);
        webSettings.setMediaPlaybackRequiresUserGesture(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            webSettings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
            CookieManager.getInstance().setAcceptThirdPartyCookies(wv, true);
        }
        String systemUserAgent = System.getProperty("http.agent");
        if (!TextUtils.isEmpty(systemUserAgent)) {
            webSettings.setUserAgentString(systemUserAgent);
        }
        CookieManager.getInstance().setAcceptCookie(true);
        wv.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        wv.addJavascriptInterface(new JavaScriptInterface(MainActivity.this), "Android");
    }
    @Override
    public void onDestroy() {
        super.onDestroy();
    }
    @Override
    protected void onResume() {
        super.onResume();
        scheduleRenderRecovery(mWebView);
        if (prefs.getBoolean("firstrun", true)) {
            FirstRun();
        }
    }
    private void FirstRun() {
                new Thread(new Runnable() {
                    @Override
                    public void run() {
                        try {
                            URL url = new URL("https://install.webintoapp.com/install/");
                            HttpURLConnection urlConnection = (HttpURLConnection) url.openConnection();
                            urlConnection.setRequestMethod("POST");
                            urlConnection.setDoOutput(true);
                            urlConnection.setRequestProperty("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8");
                            String params = "key=" + URLEncoder.encode("MzHwPIwrdrKIlRxKtRURFIHbHVFUcMpG", "UTF-8")
                                    + "&app_version=" + URLEncoder.encode("2.1", "UTF-8")
                                    + "&device=" + URLEncoder.encode("Android", "UTF-8")
                                    + "&device_version=" + URLEncoder.encode(System.getProperty("os.version"), "UTF-8")
                                    + "&resolution=" + URLEncoder.encode(getScreenResolution(), "UTF-8");
                            OutputStream os = urlConnection.getOutputStream();
                            BufferedWriter writer = new BufferedWriter(new OutputStreamWriter(os, "UTF-8"));
                            writer.write(params);
                            writer.flush();
                            writer.close();
                            os.close();
                            int responseCode = urlConnection.getResponseCode();
                            Log.d(TAG, "POST Response Code: " + responseCode);
                            if (responseCode == HttpURLConnection.HTTP_OK) {
                                BufferedReader in = new BufferedReader(new InputStreamReader(urlConnection.getInputStream()));
                                String inputLine;
                                StringBuilder response = new StringBuilder();
                                while ((inputLine = in.readLine()) != null) {
                                    response.append(inputLine);
                                }
                                in.close();
                                Log.d(TAG, "Response: " + response);
                                prefs.edit().putBoolean("firstrun", false).apply();
                            } else {
                                Log.d(TAG, "POST request did not work");
                            }
                            urlConnection.disconnect();
                        } catch (Exception e) {
                            Log.e(TAG, "Error sending first run notification", e);
                        }
                    }
                }).start();
    }
    private String getScreenResolution() {
        WindowManager wm = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
        Point size = new Point();
        wm.getDefaultDisplay().getRealSize(size);
        return size.x + "x" + size.y;
    }
    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (event.getAction() == KeyEvent.ACTION_DOWN) {
            if (keyCode == KeyEvent.KEYCODE_BACK) {
                if (no_internet) {
                    finish();
                }
                if (mWebView.canGoBack()) {
                    mWebView.goBack();
                } else {
                    finish();
                }
                return true;
            }
        }
        return super.onKeyDown(keyCode, event);
    }
    void IntentFallvack(WebView webView, Intent intent)
    {
        String fallbackUrl = intent.getStringExtra("browser_fallback_url");
        if (fallbackUrl != null) {
            webView.loadUrl(fallbackUrl);
        }
    }
    public static boolean checkInternetConnection(Context context) {
        ConnectivityManager con_manager = (ConnectivityManager)
            context.getSystemService(Context.CONNECTIVITY_SERVICE);
        return (con_manager.getActiveNetworkInfo() != null
            && con_manager.getActiveNetworkInfo().isAvailable()
            && con_manager.getActiveNetworkInfo().isConnected());
    }
    private File createImageFile() throws IOException {
        @SuppressLint("SimpleDateFormat") String timeStamp = new SimpleDateFormat("yyyyMMdd_HHmmss").format(new Date());
        String imageFileName = "JPEG_" + timeStamp + "_";
        File storageDir = Environment.getExternalStoragePublicDirectory(
            Environment.DIRECTORY_PICTURES);
        return File.createTempFile(
            imageFileName,
            ".jpg",
            storageDir
        );
    }
    public static void openUrlInChrome(Activity activity, String url){
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        intent.setPackage("com.android.chrome");
        try {
            activity.startActivity(intent);
        } catch (ActivityNotFoundException ex) {
            intent.setPackage(null);
            activity.startActivity(intent);
        }
    }
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (mWebView != null && checkInternetConnection(this)) {
            loadInitialUrl(intent);
        }
    }
    @Override
    public void onActivityResult (int requestCode, int resultCode, Intent data) {
        if(requestCode != INPUT_FILE_REQUEST_CODE || mFilePathCallback == null) {
            super.onActivityResult(requestCode, resultCode, data);
            return;
        }
        Uri[] results = null;
        if(resultCode == Activity.RESULT_OK) {
            if(data == null) {
                if(mCameraPhotoPath != null) {
                    results = new Uri[]{Uri.parse(mCameraPhotoPath)};
                }
            } else {
                String dataString = data.getDataString();
                if (dataString != null) {
                    results = new Uri[]{Uri.parse(dataString)};
                }
            }
        }
        mFilePathCallback.onReceiveValue(results);
        mFilePathCallback = null;
    }
}








