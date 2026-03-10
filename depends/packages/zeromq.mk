package=zeromq
$(package)_version=4.3.5
$(package)_download_path=https://github.com/zeromq/libzmq/releases/download/v$($(package)_version)/
$(package)_file_name=$(package)-$($(package)_version).tar.gz
$(package)_sha256_hash=6653ef5910f17954861fe72332e68b03ca6e4d9c7160eb3a8de5a5a913bfab43
$(package)_patches=remove_libstd_link.patch disable_gssapi.patch

define $(package)_set_vars
  $(package)_config_opts=--without-docs --disable-shared --disable-curve --disable-curve-keygen --disable-perf
  $(package)_config_opts += --without-libsodium --without-gssapi --without-pgm --without-norm --without-vmci
  $(package)_config_opts += --disable-libunwind --disable-radix-tree --without-gcov --disable-dependency-tracking
  $(package)_config_opts += --disable-Werror --disable-drafts --enable-option-checking
  $(package)_config_opts_linux=--with-pic
  $(package)_config_opts_android=--with-pic
  $(package)_cxxflags=-std=c++17
endef

define $(package)_preprocess_cmds
  patch -p1 < $($(package)_patch_dir)/remove_libstd_link.patch && \
  cp -f $(BASEDIR)/config.guess $(BASEDIR)/config.sub config
endef

define $(package)_config_cmds
  $($(package)_autoconf)
endef

define $(package)_build_cmds
  $(MAKE) -j16 src/libzmq.la
endef

define $(package)_stage_cmds
  $(MAKE) DESTDIR=$($(package)_staging_dir) install-libLTLIBRARIES install-includeHEADERS install-pkgconfigDATA && \
  mkdir -p $($(package)_staging_prefix_dir)/lib && \
  find $($(package)_staging_dir) -path "*/depends/x86_64-linux-gnu/lib/libzmq.a" -type f -exec cp {} $($(package)_staging_prefix_dir)/lib/ \; 2>/dev/null || \
  cp -f src/.libs/libzmq.a $($(package)_staging_prefix_dir)/lib/ 2>/dev/null || true && \
  cp -f src/.libs/libzmq.a $($(package)_staging_prefix_dir)/lib/ 2>/dev/null || true
endef

define $(package)_postprocess_cmds
  mkdir -p $($(package)_staging_prefix_dir)/lib && \
  find $($(package)_staging_dir) -path "*/depends/x86_64-linux-gnu/lib/libzmq.a" -type f -exec cp {} $($(package)_staging_prefix_dir)/lib/ \; 2>/dev/null || true && \
  find $($(package)_build_dir) -path "*/src/.libs/libzmq.a" -type f -exec cp {} $($(package)_staging_prefix_dir)/lib/ \; 2>/dev/null || true && \
  cp -f $($(package)_build_dir)/src/.libs/libzmq.a $($(package)_staging_prefix_dir)/lib/ 2>/dev/null || true && \
  rm -rf bin share && \
  find $($(package)_staging_dir) -name "*.la" -type f -delete 2>/dev/null || true && \
  cp -f $($(package)_staging_prefix_dir)/lib/libzmq.a $(BASEDIR)/x86_64-linux-gnu/lib/ 2>/dev/null || true && \
  cd $(BUILD_DIR)/src/.libs && \
  rm -f libzmq_la-gssapi_*.o && \
  $(AR) d $(BASEDIR)/x86_64-linux-gnu/lib/libzmq.a libzmq_la-gssapi_mechanism_base.o libzmq_la-gssapi_client.o libzmq_la-gssapi_server.o 2>/dev/null || true
endef
