#import <AuthenticationServices/AuthenticationServices.h>
#import <WebKit/WebKit.h>

typedef void (*TioGitReply)(void *, int, const char *);

@interface TioGitAuthentication : NSObject <ASWebAuthenticationPresentationContextProviding>
@property(nonatomic, strong) ASPresentationAnchor anchor;
@property(nonatomic, strong) ASWebAuthenticationSession *session;
@property(nonatomic, copy) NSString *owner;
@property(nonatomic) void *context;
@property(nonatomic) TioGitReply reply;
- (void)finish:(int)status callback:(NSURL *)callback;
- (void)cancel:(int)status;
@end

static NSMutableDictionary<NSString *, TioGitAuthentication *> *sessions;

@implementation TioGitAuthentication
- (ASPresentationAnchor)presentationAnchorForWebAuthenticationSession:(ASWebAuthenticationSession *)session {
    return self.anchor;
}

- (void)finish:(int)status callback:(NSURL *)callback {
    if (!self.reply) return;
    TioGitReply reply = self.reply;
    self.reply = NULL;
    [sessions removeObjectForKey:self.owner];
    self.session = nil;
    reply(self.context, status, callback.absoluteString.UTF8String);
}

- (void)cancel:(int)status {
    ASWebAuthenticationSession *session = self.session;
    [self finish:status callback:nil];
    [session cancel];
}
@end

// Tauri's platform webview callback runs on the main thread.
void tio_start_git_auth(void *rawView, const char *url, const char *owner, void *context, TioGitReply reply) {
    WKWebView *view = (__bridge WKWebView *)rawView;
    NSURL *login = [NSURL URLWithString:[NSString stringWithUTF8String:url]];
    NSString *key = [NSString stringWithUTF8String:owner];
    if (!view.window || !login || !key || sessions[key]) {
        reply(context, 2, NULL);
        return;
    }
    if (!sessions) sessions = [NSMutableDictionary new];
    TioGitAuthentication *flow = [TioGitAuthentication new];
    flow.anchor = view.window;
    flow.owner = key;
    flow.context = context;
    flow.reply = reply;
    __weak TioGitAuthentication *weakFlow = flow;
    flow.session = [[ASWebAuthenticationSession alloc]
        initWithURL:login callbackURLScheme:@"tio"
        completionHandler:^(NSURL *callback, NSError *error) {
            dispatch_async(dispatch_get_main_queue(), ^{
                BOOL cancelled = [error.domain isEqualToString:ASWebAuthenticationSessionErrorDomain] &&
                    error.code == ASWebAuthenticationSessionErrorCodeCanceledLogin;
                [weakFlow finish:callback ? 0 : (cancelled ? 1 : 2) callback:callback];
            });
        }];
    flow.session.presentationContextProvider = flow;
    sessions[key] = flow;
    if (![flow.session start]) {
        [flow finish:2 callback:nil];
        return;
    }
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 35 * 60 * NSEC_PER_SEC),
                   dispatch_get_main_queue(), ^{
        [weakFlow cancel:2];
    });
}

void tio_cancel_git_auth(const char *owner) {
    [sessions[[NSString stringWithUTF8String:owner]] cancel:1];
}
