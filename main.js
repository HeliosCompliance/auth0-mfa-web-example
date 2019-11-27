const scope = "enroll read:authenticators remove:authenticators";

let auth0 = null;

let domain;
let clientId;
let audience;
let token;


window.onload = async () => {
    log("creating auth0 client");
    var res = httpRequest({
        method: "GET",
        url: `/config.json`,
    });
    domain = res.domain;
    clientId = res.client_id;
    audience = `https://${domain}/mfa/`;

    try {
        auth0 = await createAuth0Client({
            domain: domain,
            client_id: clientId,
            audience: audience,
            scope: scope,
            redirect_uri: window.location.origin,
        });
    } catch (err) {
        log("error creating auth0 client");
        console.dir(err);
    }

    const query = window.location.search;
    if (query.includes("code=") && query.includes("state=")) {
        await auth0.handleRedirectCallback();
        window.history.replaceState({}, document.title, "/");
    }
    updateUI();
}

const updateUI = async () => {
    log("updateUI called, checking isAuthenticated");
    const isAuthenticated = await auth0.isAuthenticated();

    document.getElementById("btn-logout").disabled = !isAuthenticated;
    document.getElementById("btn-login").disabled = isAuthenticated;

    if (isAuthenticated) {
        log("authenticated");
        document.getElementById("gated-content").classList.remove("hidden");

        token = await auth0.getTokenSilently();
        document.getElementById(
            "access-token"
        ).innerHTML = token;

        document.getElementById("user-profile").innerHTML = JSON.stringify(
            await auth0.getUser(), null, 2
        );

        await refreshMfaList();
    } else {
        log("not authenticated");
        document.getElementById("gated-content").classList.add("hidden");
    }
};

const refreshMfaList = async () => {
    var mfa = httpRequest({
        method: "GET",
        url: `https://${domain}/mfa/authenticators`,
        headers: {
            authorization: `Bearer ${token}`
        }
    });
    document.getElementById("mfa-devices").innerHTML = JSON.stringify(mfa, null, 2);
}

const login = async () => {
    await auth0.loginWithRedirect({
        audience: audience,
        scope: scope,
        redirect_uri: window.location.origin
    });
};

const logout = () => {
    auth0.logout({
        returnTo: window.location.origin
    });
};

const log = (text) => {
    console.log(new Date(), text);
}

const associateMfaOtp = async () => {
    var res = httpRequest({
        method: "POST",
        url: `https://${domain}/mfa/associate`,
        headers: {
            authorization: `Bearer ${token}`
        },
        body: {
            authenticator_types: ["otp"],
        }
    });
    await refreshMfaList();
    if (!res.secret) {
        log("failed to add new otp device")
        console.dir(res)
        return
    }
    document.getElementById("verify-mfa-otp-secret").value = res.secret;
    document.getElementById("verify-mfa-otp-code").value = "";
    QRCode.toCanvas(document.getElementById("verify-mfa-otp-qr"), res.barcode_uri, function (err) {
        if (err) {
            log("failed to draw QR code");
            console.dir(err);
        }
    })

    document.getElementById("verify-mfa-otp-block").style.display = "";
}

const verifyMfaOtp = async () => {
    var code = document.getElementById("verify-mfa-otp-code").value
    var res = httpRequest({
        method: "POST",
        url: `https://${domain}/oauth/token`,
        body: {
            mfa_token: token,
            otp: code,
            grant_type: 'http://auth0.com/oauth/grant-type/mfa-otp',
            client_id: clientId,
        }
    });
    if (!res.access_token) {
        log("failed to verify otp device");
        console.dir(res);
        return;
    }
    document.getElementById("verify-mfa-otp-block").style.display = "none";
    await refreshMfaList();
}

const associateMfaSms = async () => {
    var res = httpRequest({
        method: "POST",
        url: `https://${domain}/mfa/associate`,
        headers: {
            authorization: `Bearer ${token}`
        },
        body: {
            authenticator_types: ["oob"],
            oob_channels: ["sms"],
            phone_number: document.getElementById("associate-mfa-sms-phone").value,
        }
    });
    await refreshMfaList()
    if (!res.oob_code) {
        log("failed to add new sms device");
        console.dir(res);
        return;
    }

    document.getElementById("verify-mfa-sms-code").dataset.oobCode = res.oob_code;
    document.getElementById("verify-mfa-sms-code").value = "";
    document.getElementById("verify-mfa-sms-block").style.display = "";
}

const verifyMfaSms = async () => {
    var oobCode = document.getElementById("verify-mfa-sms-code").dataset.oobCode;
    var bindingCode = document.getElementById("verify-mfa-sms-code").value;
    var res = httpRequest({
        method: "POST",
        url: `https://${domain}/oauth/token`,
        body: {
            mfa_token: token,
            oob_code: oobCode,
            binding_code: bindingCode,
            grant_type: 'http://auth0.com/oauth/grant-type/mfa-oob',
            client_id: clientId,
        }
    });
    if (!res.access_token) {
        log("failed to verify sms device");
        console.dir(res);
        return;
    }
    document.getElementById("verify-mfa-sms-block").style.display = "none";
    await refreshMfaList();
}

const deleteMfa = async () => {
    var elem = document.getElementById("delete-mfa-id");
    var id = elem.value;
    elem.value = "";
    httpRequest({
        method: "DELETE",
        url: `https://${domain}/mfa/authenticators/${id}`,
        headers: {
            authorization: `Bearer ${token}`
        }
    });
    await refreshMfaList();
}

const httpRequest = ({ method, url, body, headers }) => {
    var xmlHttp = new XMLHttpRequest();
    xmlHttp.open(method, url, false);
    if (headers) {
        for (var header in headers) {
            xmlHttp.setRequestHeader(header, headers[header]);
        }
    }
    if (body == undefined) {
        xmlHttp.send(null);
    } else if (body instanceof FormData) {
        xmlHttp.send(body);
    } else {
        xmlHttp.setRequestHeader("Content-Type", "application/json");
        xmlHttp.send(JSON.stringify(body));
    }

    if (xmlHttp.responseText == "") {
        return {};
    }

    try {
        return JSON.parse(xmlHttp.responseText);
    } catch (err) {
        return {};
    }

}